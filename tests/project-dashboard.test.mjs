import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const apartment = {
  id: 'apartment-a', name: 'Original', revision: 1,
  createdAt: '2026-08-27T12:00:00Z', updatedAt: '2026-08-27T12:00:00Z',
};

// A small hook harness exercises the actual dashboard handlers without a DOM
// dependency. Browser smoke tests cover real rendering and navigation separately.
function dashboard(fetch) {
  const state = [];
  let cursor = 0;
  let mounted = false;
  const exports = {};
  runInNewContext(compiled, {
    exports, fetch, Error,
    require(name) {
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'react') return {
        useState(initial) {
          const index = cursor++;
          if (!(index in state)) state[index] = initial;
          return [state[index], (next) => {
            state[index] = typeof next === 'function' ? next(state[index]) : next;
          }];
        },
        useEffect(effect) { if (!mounted) effect(); },
      };
      if (name === 'next/navigation') return { useRouter: () => ({ push() {} }) };
      if (name === 'next/link') return { default: 'a' };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return () => {
    cursor = 0;
    const tree = exports.default();
    mounted = true;
    return tree;
  };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const result = find(child, predicate);
    if (result) return result;
  }
}

for (const refreshFails of [false, true]) {
  test(`rename conflict stays visible when list refresh ${refreshFails ? 'fails' : 'succeeds'}`, async () => {
    const requests = [];
    const render = dashboard(async (_url, options = {}) => {
      requests.push(options.method ?? 'GET');
      if (options.method === 'PATCH') {
        assert.deepEqual(JSON.parse(options.body), { name: 'My apartment', expectedRevision: 1 });
        return Response.json({ error: 'Project changed since it was loaded' }, { status: 409 });
      }
      if (refreshFails && requests.length > 1) throw new Error('Refresh unavailable');
      return Response.json({ projects: [{ ...apartment, revision: requests.length > 1 ? 2 : 1 }] });
    });
    render();
    await setImmediate();
    find(render(), node => node.type === 'button' && node.props.children === 'Rename').props.onClick();
    find(render(), node => node.type === 'input').props.onChange({ target: { value: 'My apartment' } });
    find(render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await setImmediate();
    const tree = render();
    const alert = find(tree, node => node.props?.role === 'alert');
    assert.ok(alert, 'The rename failure should remain visible after refresh');
    assert.equal(find(alert, node => node.type === 'span').props.children, 'Project changed since it was loaded');
    assert.deepEqual(requests, ['GET', 'PATCH', 'GET']);
    assert.equal(find(tree, node => node.type === 'button' && node.props.children === 'Save').props.disabled, false);
  });
}
