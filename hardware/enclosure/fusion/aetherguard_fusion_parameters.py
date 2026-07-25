"""Create AetherGuard enclosure user parameters in Autodesk Fusion.

How to run:
1. Fusion: Utilities > Scripts and Add-Ins.
2. Add this script folder.
3. Run `aetherguard_fusion_parameters`.

The script creates named user parameters and a visible proxy enclosure model.
It is intentionally approximate, but it should be much easier to inspect than
the old single-block placeholder.

The proxy bodies are in assembled positions. Do not export this model directly
for FDM printing; use hardware/enclosure/printable/*.stl instead.
"""

import traceback

import adsk.core
import adsk.fusion


PARAMETERS = [
    ("enclosure_w", "320 mm", "Overall appliance width"),
    ("enclosure_d", "210 mm", "Overall appliance depth"),
    ("enclosure_h", "88 mm", "Overall appliance height"),
    ("corner_r", "9 mm", "External corner radius"),
    ("wall", "3.2 mm", "Prototype wall thickness"),
    ("floor_t", "3.4 mm", "Floor thickness"),
    ("roof_t", "3.2 mm", "Top-cover base thickness"),
    ("panel_t", "3.2 mm", "Front-panel thickness"),
    ("power_partition_y", "145 mm", "Logic/interlock partition origin Y"),
    ("power_partition_t", "3 mm", "Logic/interlock partition thickness"),
    ("power_partition_top_z", "76 mm", "Partition top height"),
    ("rj45_w", "18.2 mm", "RJ45 panel-coupler cutout width"),
    ("rj45_h", "15.4 mm", "RJ45 panel-coupler cutout height"),
    ("rj45_z", "29 mm", "RJ45 cutout center height"),
    ("server_port_x", "32 mm", "SERVER port center X"),
    ("lanwan_port_x", "76 mm", "LAN/WAN port center X"),
    ("mgmt_port_x", "128 mm", "MGMT port center X"),
    ("usb_c_w", "12 mm", "USB-C service cutout width"),
    ("usb_c_h", "7 mm", "USB-C service cutout height"),
    ("service_usb_x", "168 mm", "USB-C service cutout center X"),
    ("service_usb_z", "29 mm", "USB-C service cutout center Z"),
    ("button_d", "22.5 mm", "Panel button cutout diameter"),
    ("estop_x", "236 mm", "E-stop center X"),
    ("estop_z", "27 mm", "E-stop center Z"),
    ("confirm_x", "286 mm", "Confirm center X"),
    ("confirm_z", "27 mm", "Confirm center Z"),
    ("estop_guard_od", "40 mm", "E-stop guard outside diameter"),
    ("confirm_guard_od", "32 mm", "Confirm guard outside diameter"),
    ("status_window_w", "120 mm", "Four-segment status window width"),
    ("status_window_h", "13 mm", "Status window height"),
    ("status_window_x", "246 mm", "Status window center X"),
    ("status_window_z", "59 mm", "Status window center Z"),
    ("stack_light_shaft_d", "22.5 mm", "Top stack-light shaft diameter"),
    ("stack_light_x", "286 mm", "Stack-light center X"),
    ("stack_light_y", "172 mm", "Stack-light center Y"),
    ("m1_w", "145 mm", "M1 gateway fit width"),
    ("m1_d", "128 mm", "M1 gateway fit depth"),
    ("m1_h", "40 mm", "M1 gateway fit height"),
    ("m1_x", "10 mm", "M1 gateway fit origin X"),
    ("m1_y", "11 mm", "M1 gateway fit origin Y"),
    ("nucleo_w", "122 mm", "M2 NUCLEO fit width"),
    ("nucleo_d", "108 mm", "M2 NUCLEO fit depth"),
    ("nucleo_x", "168 mm", "M2 NUCLEO origin X"),
    ("nucleo_y", "35 mm", "M2 NUCLEO origin Y"),
    ("se_w", "24 mm", "M3 secure element fit width"),
    ("se_d", "24 mm", "M3 secure element fit depth"),
    ("se_h", "8 mm", "M3 secure element fit height"),
    ("se_x", "266 mm", "M3 secure element origin X"),
    ("se_y", "8 mm", "M3 secure element origin Y"),
    ("internal_din_x", "16 mm", "Internal DIN rail origin X"),
    ("internal_din_y", "160 mm", "Internal DIN rail origin Y"),
    ("internal_din_len", "288 mm", "Internal DIN rail length"),
    ("din_rail_w", "35 mm", "DIN rail width"),
]

SCRIPT_VERSION = "single-service-plane-v3"
MM_TO_CM = 0.1
PROXY_BODY_PREFIX = "AetherGuard_"
PROXY_FEATURE_NAME = "AetherGuard Proxy"
PROXY_FEATURE_PREFIX = "AetherGuard Proxy - "

X_AXIS = (1.0, 0.0, 0.0)
Y_AXIS = (0.0, 1.0, 0.0)
Z_AXIS = (0.0, 0.0, 1.0)


def mm(value):
    return float(value) * MM_TO_CM


def point(x, y, z):
    return adsk.core.Point3D.create(mm(x), mm(y), mm(z))


def vector(x, y, z):
    return adsk.core.Vector3D.create(float(x), float(y), float(z))


def delete_existing_proxy(root_comp):
    stale_features = []
    for feature in root_comp.features.baseFeatures:
        if feature.name == PROXY_FEATURE_NAME or feature.name.startswith(PROXY_FEATURE_PREFIX):
            stale_features.append(feature)

    for feature in stale_features:
        try:
            feature.deleteMe()
        except Exception:
            pass

    stale_bodies = [body for body in root_comp.bRepBodies if body.name.startswith(PROXY_BODY_PREFIX)]
    for body in stale_bodies:
        try:
            body.deleteMe()
        except Exception:
            pass


def add_temp_body(root_comp, base_feature, temp_body, name):
    suffix = name[len(PROXY_BODY_PREFIX) :] if name.startswith(PROXY_BODY_PREFIX) else name
    feature_name = f"{PROXY_FEATURE_PREFIX}{suffix}"
    feature = root_comp.features.baseFeatures.add()
    feature.name = feature_name
    feature.startEdit()

    try:
        body = root_comp.bRepBodies.add(temp_body, feature)
        if not body:
            raise RuntimeError(f"Failed to persist body: {name}")

        # In parametric designs Fusion exposes source bodies while the base
        # feature is open, then result bodies after finishEdit. Name both.
        try:
            body.name = name
        except Exception:
            pass
        try:
            feature.bodies.item(feature.bodies.count - 1).name = name
        except Exception:
            pass

        feature.finishEdit()

        result_body = root_comp.bRepBodies.item(root_comp.bRepBodies.count - 1)
        if result_body:
            result_body.name = name
            return result_body
        return body
    except Exception:
        try:
            feature.finishEdit()
        except Exception:
            pass
        try:
            feature.deleteMe()
        except Exception:
            pass
        raise


def add_box_body(root_comp, base_feature, temp_mgr, name, center_mm, length_axis, width_axis, dimensions_mm):
    box = adsk.core.OrientedBoundingBox3D.create(
        point(*center_mm),
        vector(*length_axis),
        vector(*width_axis),
        mm(dimensions_mm[0]),
        mm(dimensions_mm[1]),
        mm(dimensions_mm[2]),
    )
    temp_body = temp_mgr.createBox(box)
    if not temp_body:
        raise RuntimeError(f"Failed to create temporary box body: {name}")
    return add_temp_body(root_comp, base_feature, temp_body, name)


def add_cylinder_body(
    root_comp,
    base_feature,
    temp_mgr,
    name,
    center_mm,
    axis,
    height_mm,
    radius_mm,
):
    cx, cy, cz = center_mm
    half = float(height_mm) / 2.0
    if axis == "x":
        start = point(cx - half, cy, cz)
        end = point(cx + half, cy, cz)
    elif axis == "y":
        start = point(cx, cy - half, cz)
        end = point(cx, cy + half, cz)
    else:
        start = point(cx, cy, cz - half)
        end = point(cx, cy, cz + half)

    temp_body = temp_mgr.createCylinderOrCone(start, mm(radius_mm), end, mm(radius_mm))
    if not temp_body:
        raise RuntimeError(f"Failed to create temporary cylinder body: {name}")
    return add_temp_body(root_comp, base_feature, temp_body, name)


def create_reference_geometry(design):
    root_comp = design.rootComponent
    delete_existing_proxy(root_comp)

    temp_mgr = adsk.fusion.TemporaryBRepManager.get()
    if not temp_mgr:
        raise RuntimeError("Failed to acquire TemporaryBRepManager.")

    bodies = []

    base_feature = None

    # Shell bands and lid.
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}BottomTray",
            (160.0, 105.0, 1.7),
            X_AXIS,
            Y_AXIS,
            (320.0, 210.0, 3.4),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}LeftWall",
            (1.6, 105.0, 44.0),
            Y_AXIS,
            Z_AXIS,
            (210.0, 88.0, 3.2),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}RightWall",
            (318.4, 105.0, 44.0),
            Y_AXIS,
            Z_AXIS,
            (210.0, 88.0, 3.2),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}RearWall",
            (160.0, 208.4, 44.0),
            X_AXIS,
            Z_AXIS,
            (320.0, 88.0, 3.2),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}FrontPanel",
            (160.0, 1.6, 44.0),
            X_AXIS,
            Z_AXIS,
            (320.0, 88.0, 3.2),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}TopCover",
            (160.0, 105.0, 86.4),
            X_AXIS,
            Y_AXIS,
            (313.6, 203.6, 3.2),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}LogicInterlockPartition",
            (160.0, 146.5, 39.7),
            X_AXIS,
            Z_AXIS,
            (313.6, 72.6, 3.0),
        )
    )

    # Internal electronics proxies.
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}M1Gateway",
            (82.5, 75.0, 23.4),
            X_AXIS,
            Y_AXIS,
            (145.0, 128.0, 40.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}M2Nucleo",
            (229.0, 89.0, 11.5),
            X_AXIS,
            Y_AXIS,
            (122.0, 108.0, 2.2),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}M3SecureElement",
            (278.0, 20.0, 12.4),
            X_AXIS,
            Y_AXIS,
            (24.0, 24.0, 8.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}DINRail",
            (160.0, 177.5, 7.4),
            X_AXIS,
            Y_AXIS,
            (288.0, 35.0, 8.0),
        )
    )

    # Front-panel proxies.
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}RJ45_SERVER",
            (35.2, -6.0, 32.4),
            X_AXIS,
            Z_AXIS,
            (18.2, 15.4, 12.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}RJ45_LANWAN",
            (79.2, -6.0, 32.4),
            X_AXIS,
            Z_AXIS,
            (18.2, 15.4, 12.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}RJ45_MGMT",
            (131.2, -6.0, 32.4),
            X_AXIS,
            Z_AXIS,
            (18.2, 15.4, 12.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}USB_C",
            (171.2, -4.0, 32.4),
            X_AXIS,
            Z_AXIS,
            (12.0, 7.0, 6.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}StatusWindow",
            (249.2, -0.75, 62.4),
            X_AXIS,
            Z_AXIS,
            (120.0, 13.0, 1.5),
        )
    )
    bodies.append(
        add_cylinder_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}EStopGuard",
            (239.2, -4.5, 30.4),
            "y",
            12.0,
            20.0,
        )
    )
    bodies.append(
        add_cylinder_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}EStopButton",
            (239.2, -4.5, 30.4),
            "y",
            10.0,
            11.0,
        )
    )
    bodies.append(
        add_cylinder_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}ConfirmButton",
            (289.2, -4.5, 30.4),
            "y",
            10.0,
            11.5,
        )
    )

    # Stack light.
    bodies.append(
        add_cylinder_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}StackLightRed",
            (286.0, 172.0, 100.5),
            "z",
            8.0,
            8.0,
        )
    )
    bodies.append(
        add_cylinder_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}StackLightAmber",
            (286.0, 172.0, 111.5),
            "z",
            8.0,
            8.0,
        )
    )
    bodies.append(
        add_cylinder_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}StackLightGreen",
            (286.0, 172.0, 122.5),
            "z",
            8.0,
            8.0,
        )
    )

    try:
        app = adsk.core.Application.get()
        app.activeViewport.fit()
    except Exception:
        pass

    return len(bodies)


def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design:
            ui.messageBox("Open or create a Fusion design first.")
            return

        user_params = design.userParameters
        created = 0
        updated = 0

        for name, expression, comment in PARAMETERS:
            existing = user_params.itemByName(name)
            if existing:
                existing.expression = expression
                existing.comment = comment
                updated += 1
            else:
                value = adsk.core.ValueInput.createByString(expression)
                user_params.add(name, value, "mm", comment)
                created += 1

        body_count = create_reference_geometry(design)

        ui.messageBox(
            "AetherGuard parameters ready.\n"
            f"Version: {SCRIPT_VERSION}\n"
            f"Created: {created}\n"
            f"Updated: {updated}\n"
            f"Proxy bodies: {body_count}\n\n"
            "This is an assembly/layout reference, not a print orientation.\n"
            "Use hardware/enclosure/printable/*.stl for FDM slicing.\n\n"
            "If an old single block is still visible, hide or delete the body\n"
            "named AetherGuard_Envelope and run the script again."
        )
    except Exception:
        if ui:
            ui.messageBox("Failed:\n{}".format(traceback.format_exc()))


def stop(context):
    pass
