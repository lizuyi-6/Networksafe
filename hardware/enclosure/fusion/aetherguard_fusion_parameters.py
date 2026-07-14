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
    ("enclosure_w", "300 mm", "Overall appliance width"),
    ("enclosure_d", "210 mm", "Overall appliance depth"),
    ("enclosure_h", "118 mm", "Overall appliance height"),
    ("corner_r", "8 mm", "External corner radius"),
    ("wall", "3 mm", "Prototype wall thickness"),
    ("floor_t", "3 mm", "Floor thickness"),
    ("roof_t", "4 mm", "Top-cover thickness"),
    ("deck_t", "3 mm", "Internal electronics deck thickness"),
    ("deck_split_z", "52 mm", "Lower/upper bay split height"),
    ("panel_t", "3 mm", "Front-panel thickness"),
    ("rj45_w", "17 mm", "RJ45 cutout width"),
    ("rj45_h", "14 mm", "RJ45 cutout height"),
    ("rj45_z", "35 mm", "RJ45 cutout center height"),
    ("server_port_x", "32 mm", "SERVER port center X"),
    ("lanwan_port_x", "74 mm", "LAN/WAN port center X"),
    ("mgmt_port_x", "122 mm", "MGMT port center X"),
    ("usb_c_w", "11 mm", "USB-C service cutout width"),
    ("usb_c_h", "6 mm", "USB-C service cutout height"),
    ("service_usb_x", "156 mm", "USB-C service cutout center X"),
    ("service_usb_z", "34 mm", "USB-C service cutout center Z"),
    ("button_d", "22.5 mm", "Panel button cutout diameter"),
    ("estop_x", "208 mm", "E-stop center X"),
    ("estop_z", "36 mm", "E-stop center Z"),
    ("confirm_x", "255 mm", "Confirm center X"),
    ("confirm_z", "36 mm", "Confirm center Z"),
    ("button_guard_od", "32 mm", "Button guard outside diameter"),
    ("status_window_w", "88 mm", "Status window width"),
    ("status_window_h", "13 mm", "Status window height"),
    ("status_window_x", "197 mm", "Status window center X"),
    ("status_window_z", "77 mm", "Status window center Z"),
    ("stack_light_d", "40 mm", "Top stack-light mount diameter"),
    ("stack_light_x", "250 mm", "Stack-light center X"),
    ("stack_light_y", "158 mm", "Stack-light center Y"),
    ("m1_w", "145 mm", "M1 gateway fit width"),
    ("m1_d", "128 mm", "M1 gateway fit depth"),
    ("m1_h", "40 mm", "M1 gateway fit height"),
    ("m1_x", "13 mm", "M1 gateway fit origin X"),
    ("m1_y", "54 mm", "M1 gateway fit origin Y"),
    ("nucleo_w", "122 mm", "M2 NUCLEO fit width"),
    ("nucleo_d", "108 mm", "M2 NUCLEO fit depth"),
    ("nucleo_x", "166 mm", "M2 NUCLEO origin X"),
    ("nucleo_y", "66 mm", "M2 NUCLEO origin Y"),
    ("se_w", "24 mm", "M3 secure element fit width"),
    ("se_d", "24 mm", "M3 secure element fit depth"),
    ("se_h", "8 mm", "M3 secure element fit height"),
    ("se_x", "264 mm", "M3 secure element origin X"),
    ("se_y", "64 mm", "M3 secure element origin Y"),
    ("internal_din_x", "13 mm", "Internal DIN rail origin X"),
    ("internal_din_y", "26 mm", "Internal DIN rail origin Y"),
    ("internal_din_len", "274 mm", "Internal DIN rail length"),
    ("din_rail_w", "35 mm", "DIN rail width"),
]

SCRIPT_VERSION = "multi-body-v2"
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
            (150.0, 105.0, 1.5),
            X_AXIS,
            Y_AXIS,
            (300.0, 210.0, 3.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}LeftWall",
            (1.5, 105.0, 60.0),
            Y_AXIS,
            Z_AXIS,
            (210.0, 118.0, 3.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}RightWall",
            (298.5, 105.0, 60.0),
            Y_AXIS,
            Z_AXIS,
            (210.0, 118.0, 3.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}RearWall",
            (150.0, 208.5, 60.0),
            X_AXIS,
            Z_AXIS,
            (300.0, 118.0, 3.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}FrontPanel",
            (150.0, 1.5, 60.0),
            X_AXIS,
            Z_AXIS,
            (300.0, 118.0, 3.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}TopCover",
            (150.0, 105.0, 124.0),
            X_AXIS,
            Y_AXIS,
            (294.0, 204.0, 4.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}InternalDeck",
            (150.0, 105.0, 53.5),
            X_AXIS,
            Y_AXIS,
            (272.0, 190.0, 3.0),
        )
    )

    # Internal electronics proxies.
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}M1Gateway",
            (85.5, 118.0, 23.0),
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
            (227.0, 120.0, 59.0),
            X_AXIS,
            Y_AXIS,
            (122.0, 108.0, 12.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}M3SecureElement",
            (276.0, 76.0, 57.0),
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
            (150.0, 43.5, 21.5),
            X_AXIS,
            Y_AXIS,
            (274.0, 35.0, 8.0),
        )
    )

    # Front-panel proxies.
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}RJ45_SERVER",
            (32.0, -6.0, 35.0),
            X_AXIS,
            Z_AXIS,
            (17.0, 14.0, 12.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}RJ45_LANWAN",
            (74.0, -6.0, 35.0),
            X_AXIS,
            Z_AXIS,
            (17.0, 14.0, 12.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}RJ45_MGMT",
            (122.0, -6.0, 35.0),
            X_AXIS,
            Z_AXIS,
            (17.0, 14.0, 12.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}USB_C",
            (156.0, -4.0, 34.0),
            X_AXIS,
            Z_AXIS,
            (11.0, 6.0, 6.0),
        )
    )
    bodies.append(
        add_box_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}StatusWindow",
            (197.0, -0.75, 77.0),
            X_AXIS,
            Z_AXIS,
            (88.0, 13.0, 1.5),
        )
    )
    bodies.append(
        add_cylinder_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}EStopGuard",
            (208.0, -4.5, 36.0),
            "y",
            12.0,
            16.0,
        )
    )
    bodies.append(
        add_cylinder_body(
            root_comp,
            base_feature,
            temp_mgr,
            f"{PROXY_BODY_PREFIX}EStopButton",
            (208.0, -4.5, 36.0),
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
            (255.0, -4.5, 36.0),
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
            (250.0, 158.0, 132.0),
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
            (250.0, 158.0, 142.0),
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
            (250.0, 158.0, 152.0),
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
