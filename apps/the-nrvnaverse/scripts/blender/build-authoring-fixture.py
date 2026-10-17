# Build a synthetic Blender authoring fixture from a spec (M3 Mission B).
#
#   blender -b --factory-startup --disable-autoexec --python build-authoring-fixture.py -- <spec.json> <out.blend>
#
# The spec (`nrvna.authoring-fixture-spec/1`, committed next to the authoring sources) is written in
# the NRVNAVerse world frame: metres, +Y up, north = -Z. This script converts it into an ordinary
# Blender scene the way an artist would author it (Z up, 1 Blender unit = 1 m, unit scale 1.0):
#
#   NRVNAVerse (x, y, z)  ->  Blender (x, -z, y)          a NRVNAVerse yaw of θ = a Blender Z rotation of θ
#
# so the importer's round trip (Blender -> SIC export -> manifest) can be compared with the spec.
# It creates a NEW file only (never opens or saves anything else); textures are tiny generated PNGs
# written to `<out dir>/textures/` and referenced relatively (`//textures/...`), except the ones the
# spec marks `missing`, which point at a file that is deliberately never written.
import json
import math
import os
import sys

import bmesh
import bpy


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 2:
        raise SystemExit("usage: blender -b --factory-startup --python build-authoring-fixture.py -- <spec.json> <out.blend>")
    return argv[0], argv[1]


def to_blender(p):
    """NRVNAVerse point / size (x, y, z) -> Blender axes (x, -z, y) for points, (x, z, y) for sizes."""
    return (p[0], -p[2], p[1])


def size_to_blender(s):
    return (s[0], s[2], s[1])


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"
    return scene


def collection_for(scene, path, cache):
    """'GALLERIES/gallery-one' -> nested collections under the scene collection; None -> the scene root."""
    if not path:
        return scene.collection
    if path in cache:
        return cache[path]
    parent = scene.collection
    built = ""
    for part in path.split("/"):
        built = part if not built else built + "/" + part
        if built not in cache:
            col = bpy.data.collections.new(part)
            parent.children.link(col)
            cache[built] = col
        parent = cache[built]
    return parent


def make_textures(spec, out_dir):
    tex_dir = os.path.join(out_dir, "textures")
    os.makedirs(tex_dir, exist_ok=True)
    images = {}
    for name, rgb in sorted(spec.get("textures", {}).items()):
        img = bpy.data.images.new(name, width=8, height=8, alpha=False)
        px = []
        for i in range(64):
            shade = 1.0 if (i // 8 + i % 8) % 2 == 0 else 0.92
            px += [rgb[0] / 255 * shade, rgb[1] / 255 * shade, rgb[2] / 255 * shade, 1.0]
        img.pixels = px
        img.filepath_raw = os.path.join(tex_dir, name)
        img.file_format = "PNG"
        img.save()
        img.filepath = "//textures/" + name
        images[name] = img
    return images


def make_material(name, mspec, images):
    mat = bpy.data.materials.new(name)
    if hasattr(mat, "use_nodes"):
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    if "color" in mspec:
        c = mspec["color"]
        bsdf.inputs["Base Color"].default_value = (c[0] / 255, c[1] / 255, c[2] / 255, 1.0)
    tex_name = mspec.get("texture")
    if tex_name:
        if mspec.get("missing"):
            img = bpy.data.images.new(tex_name, width=1, height=1)
            img.source = "FILE"
            img.filepath = "//textures/" + tex_name  # deliberately never written
        else:
            img = images[tex_name]
        node = nodes.new("ShaderNodeTexImage")
        node.image = img
        mat.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def box_mesh(name, size):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    bm.to_mesh(me)
    bm.free()
    return me


def cylinder_mesh(name, radius, height):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=radius, radius2=radius, depth=height)
    bm.to_mesh(me)
    bm.free()
    return me


def main():
    spec_path, out_path = args()
    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)
    out_path = os.path.abspath(out_path)
    out_dir = os.path.dirname(out_path)
    os.makedirs(out_dir, exist_ok=True)

    scene = reset_scene()
    bpy.context.preferences.filepaths.save_version = 0  # no `.blend1` backup next to the fixture
    # Save first so `//` relative texture paths resolve against the fixture's own folder.
    bpy.ops.wm.save_as_mainfile(filepath=out_path)
    cols = {}
    # The five contract collections always exist (an empty one is valid).
    for top in ("CITY", "VENUES", "GALLERIES", "MARKERS", "DECORATION"):
        collection_for(scene, top, cols)

    images = make_textures(spec, out_dir)
    materials = {name: make_material(name, m, images) for name, m in sorted(spec.get("materials", {}).items())}

    for o in spec.get("objects", []):
        mat = materials[o["material"]]
        if o.get("material_copy"):
            mat = mat.copy()  # Blender names it "<name>.001", as an artist's accidental copy would be
        if o["shape"] == "box":
            size = o["size"]
            scale = o.get("scale", [1, 1, 1])
            # `size` is the final NRVNAVerse extent; with an object scale the mesh holds size / scale
            # (a zero scale keeps the unit mesh — the defect under test is the scale itself).
            mesh_size = [size[i] / scale[i] if scale[i] != 0 else size[i] for i in range(3)]
            me = box_mesh(o["name"], size_to_blender(mesh_size))
        elif o["shape"] == "cylinder":
            me = cylinder_mesh(o["name"], o["radius"], o["height"])
        else:
            raise SystemExit("unknown shape " + o["shape"])
        ob = bpy.data.objects.new(o["name"], me)
        ob.data.materials.append(mat)
        ob.location = to_blender(o["center"])
        ob.rotation_euler = (0.0, 0.0, math.radians(o.get("yaw_deg", 0)))
        if "scale" in o:
            ob.scale = size_to_blender(o["scale"])
        if "id" in o:
            ob["nrvna_id"] = o["id"]
        collection_for(scene, o["collection"], cols).objects.link(ob)

    for m in spec.get("markers", []):
        ob = bpy.data.objects.new(m["name"], None)  # Blender appends ".001" to a repeated name
        ob.empty_display_type = m.get("display", "PLAIN_AXES")
        ob.empty_display_size = 1.0
        ob.location = to_blender(m["at"])
        ob.rotation_euler = (math.radians(m.get("pitch_deg", 0)), 0.0, math.radians(m.get("yaw_deg", 0)))
        if "half" in m:
            ob.scale = size_to_blender(m["half"])
        for k, v in sorted(m.get("props", {}).items()):
            ob[k] = v
        collection_for(scene, m["collection"], cols).objects.link(ob)

    bpy.ops.wm.save_as_mainfile(filepath=out_path)
    print("BUILT", out_path, len(spec.get("objects", [])), "objects", len(spec.get("markers", [])), "markers")


main()
