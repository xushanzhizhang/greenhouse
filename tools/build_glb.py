import bpy, os, json, time

FBX = r"D:\greenhouse\model\source\Greenhouse.fbx"
OUT_GLB = r"D:\greenhouse\model\greenhouse_optimized.glb"
REPORT = r"C:\Users\LENOVO\AppData\Local\Doubao\User Data\Default\.doubao\agent_mode\workspace\.sessions\38454437953616898\agents\m_0cweQadofvx\glb_build_report.json"

MAX_TEX = 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
t0 = time.time()
bpy.ops.import_scene.fbx(filepath=FBX, global_scale=1.0, use_custom_normals=True)
print("import seconds:", round(time.time() - t0, 1))

# ---- 修复 Plants 材质：原始 FBX 未绑定贴图，苗床呈灰白色 ----
TEX_DIR = r"D:\greenhouse\model\textures"


def rebuild_plants():
    mat = bpy.data.materials.get("Plants")
    if not mat:
        print("Plants material not found")
        return
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (420, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (140, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    def tex(file, cs, loc, alpha=False):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.location = loc
        img = bpy.data.images.load(f"{TEX_DIR}\\{file}", check_existing=True)
        try:
            img.colorspace_settings.name = cs
        except Exception:
            pass
        n.image = img
        return n

    base = tex("Plants_Diffuse.png", "sRGB", (-360, 160))
    nt.links.new(base.outputs["Color"], bsdf.inputs["Base Color"])

    op = tex("Plants_Opacity.png", "Non-Color", (-360, -140))
    nt.links.new(op.outputs["Color"], bsdf.inputs["Alpha"])

    nrm = tex("Plants_Normal.png", "Non-Color", (-360, -420))
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.location = (-40, -420)
    nt.links.new(nrm.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    rough = tex("Plants_Roughness.png", "Non-Color", (-360, 20))
    nt.links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])

    bsdf.inputs["Metallic"].default_value = 0.0
    mat.blend_method = "CLIP"
    mat.alpha_threshold = 0.5
    print("Plants material rebuilt with diffuse/opacity/normal/roughness")


rebuild_plants()

# ---- resize textures ----
img_before_after = []
for img in bpy.data.images:
    w, h = img.size
    if w == 0 or h == 0:
        continue
    if max(w, h) > MAX_TEX:
        ratio = MAX_TEX / max(w, h)
        nw, nh = max(1, int(w * ratio)), max(1, int(h * ratio))
        try:
            img.scale(nw, nh)
            img.pack()  # keep resized data packed so exporter uses it
            img_before_after.append({"name": img.name, "from": [w, h], "to": [nw, nh]})
        except Exception as e:
            img_before_after.append({"name": img.name, "error": str(e)})

# ---- make all materials alpha-aware for glTF ----
for m in bpy.data.materials:
    if m.use_nodes and hasattr(m, "blend_method"):
        # HASHED -> MASK-like clip for glTF export (alpha_test)
        if m.blend_method in ('HASHED', 'CLIP'):
            m.blend_method = 'CLIP'
            m.alpha_threshold = 0.5
            m.show_transparent_back = False

# ---- export ----
for o in bpy.context.scene.objects:
    o.select_set(True)

t1 = time.time()
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format='GLB',
    use_selection=False,
    export_apply=True,
    export_yup=True,
    export_materials='EXPORT',
    export_image_format='AUTO',
    export_normals=True,
    export_tangents=False,
    export_cameras=False,
    export_lights=False,
    export_extras=False,
    export_draco_mesh_compression_enable=False,
)
print("export seconds:", round(time.time() - t1, 1))
print("glb bytes:", os.path.getsize(OUT_GLB))


# ---- 后处理：植被 alphaMode 由 BLEND 改为 MASK，避免半透明排序错乱与过度绘制 ----
def patch_alpha_mode(path):
    import struct
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, total = struct.unpack("<III", data[:12])
    jlen, jtype = struct.unpack("<II", data[12:20])
    js = json.loads(data[20:20 + jlen].decode("utf-8"))
    rest = data[20 + jlen:]
    changed = []
    for m in js.get("materials", []):
        if m.get("name") in ("Plants", "Bush") and m.get("alphaMode") != "MASK":
            m["alphaMode"] = "MASK"
            m["alphaCutoff"] = 0.5
            changed.append(m.get("name"))
    if not changed:
        print("alphaMode already MASK")
        return
    newjs = json.dumps(js, separators=(",", ":")).encode("utf-8")
    pad = (4 - len(newjs) % 4) % 4
    newjs += b" " * pad
    header = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(newjs) + len(rest))
    chunk = struct.pack("<II", len(newjs), 0x4E4F534A) + newjs
    with open(path, "wb") as f:
        f.write(header + chunk + rest)
    print("alphaMode patched:", changed, "new bytes:", os.path.getsize(path))


patch_alpha_mode(OUT_GLB)

with open(REPORT, "w", encoding="utf-8") as f:
    json.dump({
        "glb": OUT_GLB,
        "glb_bytes": os.path.getsize(OUT_GLB),
        "glb_mb": round(os.path.getsize(OUT_GLB) / 1048576, 2),
        "textures_resized": img_before_after,
        "import_seconds": round(t1 - t0, 1),
        "export_seconds": round(time.time() - t1, 1),
    }, f, ensure_ascii=False, indent=2)
print("DONE")
