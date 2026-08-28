export const renameProjectInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectId: { type: 'string', minLength: 1, maxLength: 128, description: 'Owned project ID. Optional in the editor, where the active project is used.' },
    name: { type: 'string', minLength: 1, maxLength: 80 },
  },
  required: ['name'],
} as const;
