import bpy, json, os
from mathutils import Vector

abc = r'''C:\Users\Sahil.Rajankar\Desktop\Shweta\Shweta_River-2.0\src\Sources\Untitled 2.abc'''
outdir = r'''C:\Users\Sahil.Rajankar\Desktop\Shweta\Shweta_River-2.0\mula-mutha-cinematic\public\models\alembic-water'''
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.alembic_import(filepath=abc, relative_path=False, set_frame_range=True, validate_meshes=True)
scene = bpy.context.scene
obj = [o for o in bpy.data.objects if o.type=='MESH'][0]

# Evaluate animation delta between frames
def mesh_positions(frame):
    scene.frame_set(frame)
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    coords = [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    return coords

c0 = mesh_positions(0)
c50 = mesh_positions(50)
c100 = mesh_positions(100)
c200 = mesh_positions(200)
c400 = mesh_positions(min(400, scene.frame_end))

def rms(a,b):
    import math
    s=0.0
    for i in range(len(a)):
        d=a[i]-b[i]
        s += d.length_squared
    return math.sqrt(s/len(a))

def maxd(a,b):
    m=0.0
    for i in range(len(a)):
        m=max(m,(a[i]-b[i]).length)
    return m

xs=[c.x for c in c0]; ys=[c.y for c in c0]; zs=[c.z for c in c0]
report={
  'object': obj.name,
  'verts': len(c0),
  'frame_start': scene.frame_start,
  'frame_end': scene.frame_end,
  'fps': scene.render.fps,
  'bbox_min': [min(xs),min(ys),min(zs)],
  'bbox_max': [max(xs),max(ys),max(zs)],
  'bbox_size': [max(xs)-min(xs), max(ys)-min(ys), max(zs)-min(zs)],
  'anim_rms_0_50': rms(c0,c50),
  'anim_max_0_50': maxd(c0,c50),
  'anim_rms_0_100': rms(c0,c100),
  'anim_max_0_100': maxd(c0,c100),
  'anim_rms_0_200': rms(c0,c200),
  'anim_max_0_200': maxd(c0,c200),
  'anim_rms_0_end': rms(c0,c400),
  'anim_max_0_end': maxd(c0,c400),
  'has_mesh_cache': any(m.type=='MESH_SEQUENCE_CACHE' for m in obj.modifiers),
}
with open(os.path.join(outdir,'abc_anim_stats.json'),'w') as f:
    json.dump(report,f,indent=2)
print(json.dumps(report, indent=2))
