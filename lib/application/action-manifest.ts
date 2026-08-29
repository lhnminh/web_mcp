export type ActionSurface = 'dashboard' | 'editor' | 'dashboard_and_editor';
export type ActionEffect = 'read' | 'transient' | 'saved_write' | 'undoable_write' | 'navigation' | 'irreversible';
export type ActionStatus = 'covered' | 'explicitly_ui_only' | 'not_yet_implemented';
export type ConfirmationPolicy = 'none' | 'human_required';

export type ActionManifestEntry = {
  id: string;
  surface: ActionSurface;
  effect: ActionEffect;
  humanEntryPoints: readonly string[];
  sharedCommand: string;
  webMcpTool?: `dwellwise.${string}`;
  agentPath?: string;
  availability: string;
  confirmationPolicy: ConfirmationPolicy;
  testIds: readonly string[];
  status: ActionStatus;
  justification?: string;
};

const covered = (
  entry: Omit<ActionManifestEntry, 'status' | 'confirmationPolicy'> & { confirmationPolicy?: ConfirmationPolicy },
): ActionManifestEntry => ({ confirmationPolicy: 'none', ...entry, status: 'covered' });

const uiOnly = (
  entry: Omit<ActionManifestEntry, 'status' | 'confirmationPolicy' | 'testIds'>,
): ActionManifestEntry => ({ ...entry, status: 'explicitly_ui_only', confirmationPolicy: 'none', testIds: ['action-manifest.contract'] });

export const ACTION_MANIFEST: readonly ActionManifestEntry[] = [
  covered({ id: 'project.list', surface: 'dashboard', effect: 'read', humanEntryPoints: ['Initial dashboard load', 'Try again'], sharedCommand: 'refreshProjects', webMcpTool: 'dwellwise.list_projects', availability: 'Dashboard is mounted', testIds: ['webmcp.dashboard', 'webmcp.pagination'] }),
  covered({ id: 'project.create', surface: 'dashboard', effect: 'saved_write', humanEntryPoints: ['Create apartment', 'Create your first apartment'], sharedCommand: 'createProjectRecord', webMcpTool: 'dwellwise.create_project', availability: 'Dashboard is loaded and not creating', testIds: ['webmcp.dashboard'] }),
  covered({ id: 'project.open', surface: 'dashboard', effect: 'navigation', humanEntryPoints: ['Project preview link', 'Project name link'], sharedCommand: 'openProject', webMcpTool: 'dwellwise.open_project', availability: 'Owned project is in the visible dashboard list', testIds: ['webmcp.dashboard'] }),
  covered({ id: 'project.rename', surface: 'dashboard_and_editor', effect: 'saved_write', humanEntryPoints: ['Dashboard Rename form', 'Editor Rename form'], sharedCommand: 'renameProject', webMcpTool: 'dwellwise.rename_project', availability: 'Owned target project is loaded', testIds: ['webmcp.dashboard', 'webmcp.editor.validation'] }),
  covered({ id: 'project.delete', surface: 'dashboard', effect: 'irreversible', humanEntryPoints: ['Dashboard Delete button'], sharedCommand: 'prepareDeleteProject', webMcpTool: 'dwellwise.prepare_delete_project', availability: 'Owned project is in the visible dashboard list', confirmationPolicy: 'human_required', testIds: ['webmcp.confirmation'] }),
  covered({ id: 'navigation.go_to_dashboard', surface: 'editor', effect: 'navigation', humanEntryPoints: ['Back to apartments link'], sharedCommand: 'goToDashboard', webMcpTool: 'dwellwise.go_to_dashboard', availability: 'Editor is mounted', testIds: ['webmcp.editor.catalog'] }),

  covered({ id: 'project.inspect', surface: 'editor', effect: 'read', humanEntryPoints: ['Visible project header, plan, panels, and status'], sharedCommand: 'getProjectSnapshot', webMcpTool: 'dwellwise.get_project_summary', availability: 'Owned project is loaded', testIds: ['webmcp.editor.reads'] }),
  covered({ id: 'furniture.list', surface: 'editor', effect: 'read', humanEntryPoints: ['Furniture panel'], sharedCommand: 'listFurniture', webMcpTool: 'dwellwise.list_furniture', availability: 'Owned project is loaded', testIds: ['webmcp.editor.reads', 'webmcp.pagination'] }),
  covered({ id: 'architecture.list', surface: 'editor', effect: 'read', humanEntryPoints: ['Architecture panel and plan'], sharedCommand: 'listArchitecture', webMcpTool: 'dwellwise.list_architecture', availability: 'Owned project is loaded', testIds: ['webmcp.editor.reads', 'webmcp.pagination'] }),
  covered({ id: 'furniture.add', surface: 'editor', effect: 'undoable_write', humanEntryPoints: ['Furniture presets and Add to apartment form'], sharedCommand: 'addObjectCommand', webMcpTool: 'dwellwise.add_furniture', availability: 'Owned project and destination room are loaded', testIds: ['webmcp.editor.validation'] }),
  covered({ id: 'furniture.update', surface: 'editor', effect: 'undoable_write', humanEntryPoints: ['Drag', 'Arrow keys', 'Rotate buttons', 'Dimension sliders', 'Room reassignment'], sharedCommand: 'persistObjectUpdate', webMcpTool: 'dwellwise.update_furniture', availability: 'Unlocked furniture item is in the active layout', testIds: ['webmcp.editor.validation'] }),
  covered({ id: 'furniture.remove', surface: 'editor', effect: 'undoable_write', humanEntryPoints: ['Remove furniture button'], sharedCommand: 'removeObjectCommand', webMcpTool: 'dwellwise.remove_furniture', availability: 'Unlocked furniture item is in the active layout', testIds: ['webmcp.editor.validation'] }),
  covered({ id: 'finish.update', surface: 'editor', effect: 'undoable_write', humanEntryPoints: ['Double-click a 3D surface', '3D Finish Studio'], sharedCommand: 'updateMaterialFinish', webMcpTool: 'dwellwise.update_finish', availability: 'Owned project is loaded and a valid material target is selected', testIds: ['webmcp.editor.catalog', 'materials.harmony'] }),
  covered({ id: 'apartment.resize', surface: 'editor', effect: 'undoable_write', humanEntryPoints: ['Apartment dimension sliders and numeric fields'], sharedCommand: 'resizeApartment', webMcpTool: 'dwellwise.resize_apartment', availability: 'Owned project is loaded', testIds: ['webmcp.editor.validation'] }),
  covered({ id: 'room.rename', surface: 'editor', effect: 'undoable_write', humanEntryPoints: ['Room name editor'], sharedCommand: 'renameRoomCommand', webMcpTool: 'dwellwise.rename_room', availability: 'Owned room is loaded', testIds: ['webmcp.architecture'] }),

  covered({ id: 'wall.add', surface: 'editor', effect: 'undoable_write', humanEntryPoints: ['Draw interior wall'], sharedCommand: 'addWallCommand', webMcpTool: 'dwellwise.add_wall', availability: 'Architecture mode and owned project are loaded', testIds: ['webmcp.architecture'] }),
  covered({ id: 'wall.update', surface: 'editor', effect: 'undoable_write', humanEntryPoints: ['Wall fields', 'Wall endpoint drag', 'Wall edge drag'], sharedCommand: 'updateWallCommand', webMcpTool: 'dwellwise.update_wall', availability: 'Owned wall is loaded', testIds: ['webmcp.architecture'] }),
  covered({ id: 'wall.remove', surface: 'editor', effect: 'undoable_write', humanEntryPoints: ['Remove interior wall'], sharedCommand: 'removeWallCommand', webMcpTool: 'dwellwise.remove_wall', availability: 'Eligible interior wall has no openings', testIds: ['webmcp.architecture'] }),
  covered({ id: 'exterior_corner.add', surface: 'editor', effect: 'undoable_write', humanEntryPoints: ['Add exterior corner'], sharedCommand: 'addExteriorCornerCommand', webMcpTool: 'dwellwise.add_exterior_corner', availability: 'Eligible exterior wall is loaded', testIds: ['webmcp.architecture'] }),
  covered({ id: 'exterior_corner.remove', surface: 'editor', effect: 'undoable_write', humanEntryPoints: ['Remove exterior corner'], sharedCommand: 'removeExteriorCornerCommand', webMcpTool: 'dwellwise.remove_exterior_corner', availability: 'Eligible exterior endpoint is loaded', testIds: ['webmcp.architecture'] }),
  covered({ id: 'opening.add', surface: 'editor', effect: 'undoable_write', humanEntryPoints: ['Add door', 'Add window'], sharedCommand: 'addOpeningCommand', webMcpTool: 'dwellwise.add_opening', availability: 'Eligible wall is loaded', testIds: ['webmcp.architecture'] }),
  covered({ id: 'opening.update', surface: 'editor', effect: 'undoable_write', humanEntryPoints: ['Opening fields', 'Opening drag', 'Swing controls'], sharedCommand: 'updateOpeningCommand', webMcpTool: 'dwellwise.update_opening', availability: 'Owned opening is loaded', testIds: ['webmcp.architecture'] }),
  covered({ id: 'opening.remove', surface: 'editor', effect: 'undoable_write', humanEntryPoints: ['Remove door or window'], sharedCommand: 'removeOpeningCommand', webMcpTool: 'dwellwise.remove_opening', availability: 'Owned opening is loaded', testIds: ['webmcp.architecture'] }),

  covered({ id: 'history.undo', surface: 'editor', effect: 'saved_write', humanEntryPoints: ['Undo button'], sharedCommand: 'undo', webMcpTool: 'dwellwise.undo', availability: 'Owned project is loaded; stack may be empty', testIds: ['webmcp.history'] }),
  covered({ id: 'history.redo', surface: 'editor', effect: 'saved_write', humanEntryPoints: ['Redo button'], sharedCommand: 'redo', webMcpTool: 'dwellwise.redo', availability: 'Owned project is loaded; stack may be empty', testIds: ['webmcp.history'] }),
  covered({ id: 'view.set', surface: 'editor', effect: 'transient', humanEntryPoints: ['2D plan tab', '3D preview tab', 'Architecture mode', 'Furnish mode'], sharedCommand: 'selectView', webMcpTool: 'dwellwise.set_editor_view', availability: 'Owned project is loaded', testIds: ['webmcp.editor.catalog'] }),
  covered({ id: 'view.sunlight', surface: 'editor', effect: 'transient', humanEntryPoints: ['Sunlight slider', 'Camera step buttons', 'Measurement toggle'], sharedCommand: 'setSunlightPreview', webMcpTool: 'dwellwise.set_sunlight_preview', availability: 'Owned project is loaded', testIds: ['webmcp.editor.catalog'] }),
  covered({ id: 'selection.select', surface: 'editor', effect: 'transient', humanEntryPoints: ['Room, wall, opening, and furniture selection controls'], sharedCommand: 'selectEntity', webMcpTool: 'dwellwise.select_entity', availability: 'Target entity exists in the owned project', testIds: ['webmcp.editor.catalog'] }),
  covered({ id: 'view.plan_zoom', surface: 'editor', effect: 'transient', humanEntryPoints: ['Zoom out', 'Zoom in'], sharedCommand: 'setPlanZoom', webMcpTool: 'dwellwise.set_plan_zoom', availability: 'Plan view is available', testIds: ['webmcp.editor.validation'] }),
  covered({ id: 'view.reset_3d_camera', surface: 'editor', effect: 'transient', humanEntryPoints: ['Reset perspective'], sharedCommand: 'reset3dCamera', webMcpTool: 'dwellwise.reset_3d_camera', availability: 'Owned project is loaded', testIds: ['webmcp.editor.catalog'] }),
  covered({ id: 'project.reset', surface: 'editor', effect: 'irreversible', humanEntryPoints: ['Reset everything'], sharedCommand: 'prepareResetProject', webMcpTool: 'dwellwise.prepare_reset_project', availability: 'Owned project is loaded', confirmationPolicy: 'human_required', testIds: ['webmcp.confirmation'] }),

  uiOnly({ id: 'ui.furniture_search', surface: 'editor', effect: 'transient', humanEntryPoints: ['Furniture search field'], sharedCommand: 'filterVisibleFurniture', agentPath: 'Use dwellwise.list_furniture with room filtering and inspect structured names.', availability: 'Furniture panel is visible', justification: 'Search only filters local presentation and does not change product state.' }),
  uiOnly({ id: 'ui.freeform_camera', surface: 'editor', effect: 'transient', humanEntryPoints: ['3D orbit', '3D pan', '3D scroll zoom'], sharedCommand: 'threeCameraControls', agentPath: 'Use dwellwise.set_sunlight_preview camera steps and the planned dwellwise.reset_3d_camera tool.', availability: '3D preview is visible', justification: 'Free-form pointer manipulation is intentionally human-only; bounded semantic camera controls cover agent inspection.' }),
  uiOnly({ id: 'ui.static_surfaces', surface: 'editor', effect: 'read', humanEntryPoints: ['Evaluation', 'Comparison', 'Priorities', 'Export placeholders'], sharedCommand: 'none', agentPath: 'No agent path until these controls become functional product capabilities.', availability: 'Static or hidden', justification: 'Approved decision 6 excludes hidden and static surfaces until they become functional.' }),
] as const;

export const COVERED_WEBMCP_TOOLS = ACTION_MANIFEST
  .filter((entry) => entry.status === 'covered' && entry.webMcpTool)
  .map((entry) => entry.webMcpTool as `dwellwise.${string}`);
