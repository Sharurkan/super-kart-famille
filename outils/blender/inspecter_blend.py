# Liste les objets d'un .blend (nom, type, polygones, dimensions, matériaux, collection) :
# blender -b fichier.blend --python inspecter_blend.py
import bpy

for o in bpy.data.objects:
    poly = len(o.data.polygons) if o.type == "MESH" else 0
    mats = [m.name for m in o.data.materials if m] if o.type == "MESH" else []
    cols = [c.name for c in o.users_collection]
    d = o.dimensions
    print(f"OBJ {o.name!r} {o.type} poly={poly} dim=({d.x:.1f},{d.y:.1f},{d.z:.1f}) loc=({o.location.x:.1f},{o.location.y:.1f},{o.location.z:.1f}) parent={o.parent.name if o.parent else None} mats={mats} cols={cols} hide={o.hide_render} inst={o.instance_type}")
for n in bpy.data.node_groups:
    print("NODEGROUP", n.name)
