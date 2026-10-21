"""Run with Blender --background --python; never saves or changes the input .blend."""
import bpy, json, math, os
from mathutils import Vector

output = os.path.abspath('public/assets/template.json')
base = bpy.data.objects['Plane']
base_points = [base.matrix_world @ v.co for v in base.data.vertices]
x0, y0, z0 = [min(p[i] for p in base_points) for i in range(3)]
width, height, thickness = [max(p[i] for p in base_points) - min(p[i] for p in base_points) for i in range(3)]
roles = {'Plane':('base','base','pink'), 'Plane.002':('panel','fixed-panel','white'), 'Plane.028':('panel-detail','fixed-detail','black'), 'Text.001':('label','editable-label','white')}
objects=[]
decoration_index=0
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH': continue
    obj.data.calc_loop_triangles()
    coords = [obj.matrix_world @ v.co - Vector((x0,y0,z0)) for v in obj.data.vertices]
    bounds = [min(p[i] for p in coords) for i in range(3)] + [max(p[i] for p in coords) for i in range(3)]
    if obj.name in roles:
        oid, role, color = roles[obj.name]
    else:
        oid,role,color=f'decoration-{decoration_index}','decoration',('black' if obj.name=='立方体.191' else 'white')
        decoration_index+=1
    triangles=[tuple(t.vertices) for t in obj.data.loop_triangles]
    svg=[]
    for tri in triangles:
        pts=[(coords[v].x,height-coords[v].y) for v in tri]
        area=sum(pts[i][0]*pts[(i+1)%3][1]-pts[(i+1)%3][0]*pts[i][1] for i in range(3))
        if abs(area)<1e-7: continue
        if area<0: pts.reverse()
        svg.append('M'+'L'.join(f'{p[0]:.6f},{p[1]:.6f}' for p in pts)+'Z')
    objects.append({'id':oid,'name':obj.name,'role':role,'colorId':color,'positions':[round(float(v),7) for p in coords for v in p],'indices':[v for t in triangles for v in t],'outlinePath':''.join(svg),'bounds':bounds,'height':bounds[5]-bounds[2]})
panel=next(o for o in objects if o['role']=='fixed-panel')
b=panel['bounds']
data={'version':'maimai-template-v1','source':'通行证模板.blend / 原文件只读提取','width':width,'height':height,'thickness':thickness,'panelBounds':[b[0],height-b[4],b[3]-b[0],b[4]-b[1]],'objects':objects}
os.makedirs(os.path.dirname(output),exist_ok=True)
with open(output,'w',encoding='utf-8') as f: json.dump(data,f,ensure_ascii=False,separators=(',',':'))
print('TEMPLATE_EXTRACTED='+json.dumps({'output':output,'width':width,'height':height,'thickness':thickness,'objects':len(objects),'panelBounds':data['panelBounds']},ensure_ascii=False))
