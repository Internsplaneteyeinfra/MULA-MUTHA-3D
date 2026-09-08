import bpy, json, os, math
from mathutils import Vector

abc = r'''C:\Users\Sahil.Rajankar\Desktop\Shweta\Shweta_River-2.0\src\Sources\Untitled 2.abc'''
outdir = r'''C:\Users\Sahil.Rajankar\Desktop\Shweta\Shweta_River-2.0\mula-mutha-cinematic\public\models\alembic-water'''
os.makedirs(outdir, exist_ok=True)

# fresh scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# try alembic import
try:
    bpy.ops.wm.alembic_import(filepath=abc, relative_path=False, set_frame_range=True, validate_meshes=True)
    import_ok = True
    import_err = None
except Exception as e:
    import_ok = False
    import_err = str(e)

scene = bpy.context.scene
info = {
  'import_ok': import_ok,
  'import_err': import_err,
  'frame_start': scene.frame_start,
  'frame_end': scene.frame_end,
  'fps': scene.render.fps,
  'objects': []
}

for obj in bpy.data.objects:
    o = {
      'name': obj.name,
      'type': obj.type,
      'location': list(obj.location),
      'scale': list(obj.scale),
      'modifiers': [m.type for m in obj.modifiers],
      'animation_data': bool(obj.animation_data),
      'parent': obj.parent.name if obj.parent else None,
    }
    if obj.type == 'MESH' and obj.data:
        me = obj.data
        o['verts'] = len(me.vertices)
        o['polygons'] = len(me.polygons)
        o['edges'] = len(me.edges)
        o['has_uv'] = bool(me.uv_layers)
        o['materials'] = [m.name for m in me.materials if m]
        # bounds in world
        coords = [obj.matrix_world @ v.co for v in me.vertices]
        if coords:
            xs=[c.x for c in coords]; ys=[c.y for c in coords]; zs=[c.z for c in coords]
            o['bbox_min']=[min(xs),min(ys),min(zs)]
            o['bbox_max']=[max(xs),max(ys),max(zs)]
            o['bbox_size']=[max(xs)-min(xs), max(ys)-min(ys), max(zs)-min(zs)]
        # check shape keys / mesh cache
        o['shape_keys'] = bool(me.shape_keys)
        if me.shape_keys:
            o['shape_key_names']=[kb.name for kb in me.shape_keys.key_blocks]
        # MeshSequenceCache / Alembic modifiers
        for m in obj.modifiers:
            if m.type == 'MESH_SEQUENCE_CACHE':
                o['mesh_cache'] = {
                  'cache_file': getattr(getattr(m,'cache_file',None),'filepath',None),
                  'object_path': getattr(m,'object_path',None),
                }
    info['objects'].append(o)

with open(os.path.join(outdir, 'abc_inspect.json'), 'w') as f:
    json.dump(info, f, indent=2)

# Export first mesh as GLB (static first frame) for web use
meshes=[o for o in bpy.data.objects if o.type=='MESH']
if meshes:
    # select largest mesh as water candidate
    meshes.sort(key=lambda o: len(o.data.vertices), reverse=True)
    water=meshes[0]
    bpy.ops.object.select_all(action='DESELECT')
    water.select_set(True)
    bpy.context.view_layer.objects.active = water
    # apply transforms for export
    glb=os.path.join(outdir, 'water_from_abc.glb')
    bpy.ops.export_scene.gltf(filepath=glb, use_selection=True, export_apply=True, export_animations=True, export_morph=True)
    info['exported_glb']=glb
    info['exported_object']=water.name
    with open(os.path.join(outdir, 'abc_inspect.json'), 'w') as f:
        json.dump(info, f, indent=2)
print('DONE', json.dumps({k:info[k] for k in info if k!='objects'}))
for o in info['objects']:
    print('OBJ', o.get('name'), o.get('type'), 'v', o.get('verts'), 'f', o.get('polygons'), 'mods', o.get('modifiers'))
