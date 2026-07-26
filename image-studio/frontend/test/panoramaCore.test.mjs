import assert from "node:assert/strict";
import test from "node:test";

const panorama = await import("../src/panorama/core.ts");

function approx(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

function shotTanAspect(shot) {
  const tanH = Math.tan((shot.hFOV_deg * Math.PI) / 360);
  const tanV = Math.tan((shot.vFOV_deg * Math.PI) / 360);
  return tanH / tanV;
}

function bbox(points) {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

test("detects likely 2:1 panoramas by concrete image size or declared size value", () => {
  assert.equal(panorama.isLikelyPanoramaRatio(2048, 1024), true);
  assert.equal(panorama.isLikelyPanoramaRatio(1536, 864), false);
  assert.equal(panorama.isLikelyPanoramaItem({
    width: 2048,
    height: 1024,
    previewWidth: undefined,
    previewHeight: undefined,
    size: "16:9@1k",
  }), true);
  assert.equal(panorama.isLikelyPanoramaItem({
    width: undefined,
    height: undefined,
    previewWidth: undefined,
    previewHeight: undefined,
    size: "2:1@1k",
  }), true);
  assert.equal(panorama.isLikelyPanoramaItem({
    width: undefined,
    height: undefined,
    previewWidth: undefined,
    previewHeight: undefined,
    size: "16:9@1k",
  }), false);
});

test("applies square and landscape aspect presets using TY360-style output sizing", () => {
  const baseShot = panorama.createDefaultPanoramaShot({ width: 2048, height: 1024 });
  const squareShot = panorama.applyPanoramaAspectPreset(baseShot, "1:1");
  assert.equal(squareShot.aspect_id, "1:1");
  assert.equal(squareShot.out_w, 1024);
  assert.equal(squareShot.out_h, 1024);
  approx(squareShot.hFOV_deg, squareShot.vFOV_deg);

  const wideShot = panorama.applyPanoramaAspectPreset(baseShot, "16:9");
  assert.equal(wideShot.aspect_id, "16:9");
  assert.equal(wideShot.out_w, 1024);
  assert.equal(wideShot.out_h, 576);
  assert.ok(wideShot.hFOV_deg > wideShot.vFOV_deg);
  approx(shotTanAspect(wideShot), 16 / 9, 1e-6);
});

test("keeps the 9:16 preset portrait even when starting from the default landscape lens", () => {
  const portraitShot = panorama.applyPanoramaAspectPreset(
    panorama.createDefaultPanoramaShot({ width: 2048, height: 1024 }),
    "9:16",
  );
  assert.equal(portraitShot.aspect_id, "9:16");
  assert.equal(portraitShot.out_w, 576);
  assert.equal(portraitShot.out_h, 1024);
  assert.ok(portraitShot.hFOV_deg < portraitShot.vFOV_deg);
  approx(shotTanAspect(portraitShot), 9 / 16, 1e-6);
});

test("sets panorama output by longest edge while preserving the current aspect", () => {
  const baseShot = panorama.createDefaultPanoramaShot({ width: 2048, height: 1024 });

  const wideShot = panorama.setPanoramaShotOutputLongEdge(
    panorama.applyPanoramaAspectPreset(baseShot, "16:9"),
  );
  assert.equal(wideShot.aspect_id, "16:9");
  assert.equal(wideShot.out_w, 2048);
  assert.equal(wideShot.out_h, 1152);

  const portraitShot = panorama.setPanoramaShotOutputLongEdge(
    panorama.applyPanoramaAspectPreset(baseShot, "9:16"),
  );
  assert.equal(portraitShot.aspect_id, "9:16");
  assert.equal(portraitShot.out_w, 1152);
  assert.equal(portraitShot.out_h, 2048);

  const squareShot = panorama.setPanoramaShotOutputLongEdge(
    panorama.applyPanoramaAspectPreset(baseShot, "1:1"),
    1536,
  );
  assert.equal(squareShot.aspect_id, "1:1");
  assert.equal(squareShot.out_w, 1536);
  assert.equal(squareShot.out_h, 1536);
});

test("scaling a shot field of view keeps the selected aspect ratio locked", () => {
  const portraitShot = panorama.applyPanoramaAspectPreset(
    panorama.createDefaultPanoramaShot({ width: 2048, height: 1024 }),
    "9:16",
  );
  const scaledShot = panorama.scalePanoramaShotFieldOfView(portraitShot, 1.35);
  assert.ok(scaledShot.hFOV_deg > portraitShot.hFOV_deg);
  assert.ok(scaledShot.vFOV_deg > portraitShot.vFOV_deg);
  approx(shotTanAspect(scaledShot), shotTanAspect(portraitShot), 1e-6);
});

test("builds roundtrip metadata that points back to the ERP source", () => {
  const source = {
    id: "history-panorama-1",
    savedPath: "C:/tmp/pano.png",
    width: 2048,
    height: 1024,
  };
  const shot = {
    ...panorama.createDefaultPanoramaShot(source),
    yaw_deg: 32,
    pitch_deg: -10,
    roll_deg: 4,
    hFOV_deg: 70,
    vFOV_deg: 44,
    out_w: 1024,
    out_h: 576,
    aspect_id: "16:9",
  };
  const roundtrip = panorama.buildPanoramaRoundtripRef(source, shot);
  assert.equal(roundtrip.sourceHistoryId, source.id);
  assert.equal(roundtrip.sourcePath, source.savedPath);
  assert.equal(roundtrip.roundtripState.kind, "ty360_roundtrip_state");
  assert.equal(roundtrip.roundtripState.source_erp.width, 2048);
  assert.equal(roundtrip.roundtripState.source_erp.height, 1024);
  assert.equal(roundtrip.roundtripState.rect.width, 1024);
  assert.equal(roundtrip.roundtripState.rect.height, 576);
  assert.equal(roundtrip.roundtripState.pose.yaw_deg, 32);
  assert.equal(roundtrip.roundtripState.pose.pitch_deg, -10);
  assert.equal(roundtrip.roundtripState.pose.roll_deg, 4);
  approx(roundtrip.roundtripState.source_aspect, 1024 / 576);
});

test("resolves roundtrip metadata from either the history item or its source images", () => {
  const source = {
    id: "history-panorama-2",
    savedPath: "C:/tmp/pano-2.png",
    width: 2048,
    height: 1024,
  };
  const shot = {
    ...panorama.createDefaultPanoramaShot(source),
    out_w: 1024,
    out_h: 1024,
    aspect_id: "1:1",
  };
  const roundtrip = panorama.buildPanoramaRoundtripRef(source, shot);

  const direct = panorama.resolvePanoramaRoundtripRef({
    panoramaRoundtrip: roundtrip,
    sourceImages: undefined,
  });
  const fromSourceImages = panorama.resolvePanoramaRoundtripRef({
    panoramaRoundtrip: undefined,
    sourceImages: [
      {
        path: "C:/tmp/lens.png",
        name: "lens.png",
        size: 0,
        panoramaRoundtrip: roundtrip,
      },
    ],
  });

  assert.deepEqual(direct, roundtrip);
  assert.deepEqual(fromSourceImages, roundtrip);
  assert.equal(panorama.hasPanoramaRoundtripRef({ panoramaRoundtrip: undefined, sourceImages: [] }), false);
  assert.equal(panorama.hasPanoramaRoundtripRef({
    panoramaProject: {
      sourceHistoryId: source.id,
      sourcePath: source.savedPath,
      role: "pasted-panorama",
    },
    panoramaRoundtrip: roundtrip,
    sourceImages: undefined,
  }), false);
});

test("groups panorama outputs under the same source project", () => {
  const source = {
    id: "pano-source",
    savedPath: "C:/tmp/source.png",
    width: 2048,
    height: 1024,
    size: "2048x1024",
    panoramaProject: {
      sourceHistoryId: "pano-source",
      sourcePath: "C:/tmp/source.png",
      role: "source",
    },
  };
  const shot = {
    id: "shot-1",
    savedPath: "C:/tmp/shot.png",
    width: 1024,
    height: 576,
    size: "1024x576",
    panoramaProject: panorama.buildPanoramaProjectRef(source, "shot", { shotHistoryId: "shot-1" }),
  };
  const pasted = {
    id: "pasted-1",
    savedPath: "C:/tmp/pasted.png",
    width: 2048,
    height: 1024,
    size: "2048x1024",
    panoramaProject: {
      sourceHistoryId: "pano-source",
      sourcePath: "C:/tmp/source.png",
      role: "pasted-panorama",
      shotHistoryId: "shot-1",
      editedShotHistoryId: "edited-1",
    },
  };
  const unrelated = {
    id: "other",
    width: 1536,
    height: 864,
    size: "1536x864",
  };

  const outputs = panorama.panoramaProjectOutputsForSource([unrelated, pasted, source, shot], source);
  assert.deepEqual(outputs.map((item) => item.id), ["pasted-1", "shot-1"]);
});

test("uses a 10% feather mask that stays opaque in the center and softens the edges", () => {
  approx(panorama.panoramaRoundtripFeatherMaskAt(0.5, 0.5), 1, 1e-6);
  assert.equal(panorama.panoramaRoundtripFeatherMaskAt(0, 0.5), 0);
  assert.equal(panorama.panoramaRoundtripFeatherMaskAt(0.5, 0), 0);

  const nearEdge = panorama.panoramaRoundtripFeatherMaskAt(0.03, 0.5);
  const midRamp = panorama.panoramaRoundtripFeatherMaskAt(0.06, 0.5);
  const beyondFeather = panorama.panoramaRoundtripFeatherMaskAt(0.16, 0.5);

  assert.ok(nearEdge > 0 && nearEdge < midRamp, `expected feather ramp to rise away from the edge, got ${nearEdge} vs ${midRamp}`);
  assert.ok(midRamp < 1, `expected feather ramp to stay below 1 inside the 10% edge band, got ${midRamp}`);
  approx(beyondFeather, 1, 1e-6);
});

test("samples panorama pasteback mask alpha in shot normalized space", () => {
  const mask = {
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([
      0, 0, 0, 0,
      255, 255, 255, 255,
      255, 255, 255, 128,
    ]),
  };

  approx(panorama.panoramaPastebackMaskAlphaAt(null, 0.2, 0.5), 1);
  approx(panorama.panoramaPastebackMaskAlphaAt(mask, 0, 0.5), 0);
  approx(panorama.panoramaPastebackMaskAlphaAt(mask, 0.5, 0.5), 1);
  const right = panorama.panoramaPastebackMaskAlphaAt(mask, 1, 0.5);
  assert.ok(right > 0.5 && right < 1, `expected semi-transparent mask alpha, got ${right}`);
});

test("maps manual pasteback alignment from expected rect space into edited image samples", () => {
  const center = panorama.mapPanoramaPastebackSample(0.5, 0.5, 1024, 576, 1024, 576, null);
  approx(center.x, 511.5);
  approx(center.y, 287.5);

  const shifted = panorama.mapPanoramaPastebackSample(0.5, 0.5, 1024, 576, 1024, 576, {
    offsetXRatio: 0.1,
    offsetYRatio: -0.05,
    scale: 1,
    rotationDeg: 0,
  });
  assert.ok(shifted.x < center.x, `expected positive preview X offset to sample further left, got ${shifted.x}`);
  assert.ok(shifted.y > center.y, `expected negative preview Y offset to sample lower, got ${shifted.y}`);

  const resized = panorama.mapPanoramaPastebackSample(0.5, 0.5, 1200, 900, 1024, 576, {
    offsetXRatio: 0,
    offsetYRatio: 0,
    scale: 1,
    rotationDeg: 0,
  });
  approx(resized.x, 599.5);
  approx(resized.y, 449.5);
  assert.equal(resized.inside, true);

  const rotated = panorama.mapPanoramaPastebackSample(0.75, 0.5, 1024, 576, 1024, 576, {
    offsetXRatio: 0,
    offsetYRatio: 0,
    scale: 1,
    rotationDeg: 15,
  });
  assert.notEqual(Math.round(rotated.y), Math.round(center.y));
});

test("projects pano overlay geometry from the current shot aspect", () => {
  const baseShot = panorama.createDefaultPanoramaShot({ width: 2048, height: 1024 });
  const square = panorama.buildPanoramaPanoOverlayGeometry(
    panorama.applyPanoramaAspectPreset(baseShot, "1:1"),
    0,
    0,
    100,
    800,
    400,
  );
  const wide = panorama.buildPanoramaPanoOverlayGeometry(
    panorama.applyPanoramaAspectPreset(baseShot, "16:9"),
    0,
    0,
    100,
    800,
    400,
  );
  const portraitBase = {
    ...baseShot,
    hFOV_deg: 40,
    vFOV_deg: 64,
    out_w: 576,
    out_h: 1024,
  };
  const portrait = panorama.buildPanoramaPanoOverlayGeometry(
    panorama.applyPanoramaAspectPreset(portraitBase, "9:16"),
    0,
    0,
    100,
    800,
    400,
  );

  assert.equal(square.visible, true);
  assert.equal(wide.visible, true);
  assert.equal(portrait.visible, true);
  approx(square.center.x, 400, 1e-6);
  approx(square.center.y, 200, 1e-6);

  const squareBox = bbox(square.corners);
  const wideBox = bbox(wide.corners);
  const portraitBox = bbox(portrait.corners);
  const squareAspect = (squareBox.maxX - squareBox.minX) / (squareBox.maxY - squareBox.minY);
  const wideAspect = (wideBox.maxX - wideBox.minX) / (wideBox.maxY - wideBox.minY);
  const portraitAspect = (portraitBox.maxX - portraitBox.minX) / (portraitBox.maxY - portraitBox.minY);

  approx(squareAspect, 1, 0.05);
  assert.ok(wideAspect > 1.4, `expected wide overlay to stay landscape, got ${wideAspect}`);
  assert.ok(portraitAspect < 0.75, `expected portrait overlay to stay portrait, got ${portraitAspect}`);
});

test("keeps pano overlay geometry finite near the view edge and rotates with roll", () => {
  const edgeShot = {
    ...panorama.createDefaultPanoramaShot({ width: 2048, height: 1024 }),
    yaw_deg: 34,
    pitch_deg: -8,
    hFOV_deg: 72,
    vFOV_deg: 48,
    out_w: 1024,
    out_h: 680,
    aspect_id: "3:2",
  };
  const edgeOverlay = panorama.buildPanoramaPanoOverlayGeometry(
    edgeShot,
    0,
    0,
    70,
    800,
    400,
  );
  const centeredShot = {
    ...edgeShot,
    yaw_deg: 0,
    pitch_deg: 0,
  };
  const withoutRoll = panorama.buildPanoramaPanoOverlayGeometry(
    centeredShot,
    0,
    0,
    70,
    800,
    400,
  );
  const withRoll = panorama.buildPanoramaPanoOverlayGeometry(
    { ...centeredShot, roll_deg: 18 },
    0,
    0,
    70,
    800,
    400,
  );

  assert.equal(edgeOverlay.visible, true);
  assert.equal(withoutRoll.visible, true);
  assert.equal(withRoll.visible, true);
  [...edgeOverlay.corners, ...edgeOverlay.edgeMidpoints].forEach((point) => {
    assert.ok(Number.isFinite(point.x), "expected overlay x to stay finite");
    assert.ok(Number.isFinite(point.y), "expected overlay y to stay finite");
  });
  [edgeOverlay.rotateStemBase, edgeOverlay.rotateHandle, withoutRoll.rotateStemBase, withRoll.rotateHandle].forEach((point) => {
    assert.ok(point, "expected rotate handle geometry to exist");
    assert.ok(Number.isFinite(point.x), "expected rotate geometry x to stay finite");
    assert.ok(Number.isFinite(point.y), "expected rotate geometry y to stay finite");
  });
  assert.ok(Math.abs(withoutRoll.corners[0].y - withoutRoll.corners[1].y) < 1e-6);
  assert.ok(Math.abs(withRoll.corners[0].y - withRoll.corners[1].y) > 8);
});

test("hides pano overlay geometry when the shot center is behind the current view", () => {
  const hidden = panorama.buildPanoramaPanoOverlayGeometry(
    {
      ...panorama.createDefaultPanoramaShot({ width: 2048, height: 1024 }),
      yaw_deg: 180,
      pitch_deg: 0,
    },
    0,
    0,
    100,
    800,
    400,
  );

  assert.equal(hidden.visible, false);
  assert.equal(hidden.center, null);
  assert.equal(hidden.corners.length, 0);
  assert.equal(hidden.edgeMidpoints.length, 0);
});
