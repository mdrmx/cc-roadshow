/*
 * Face Mesh with Texture Mapping — ml5.js faceMesh demo
 *
 * TRIANGULATION (defined in triangulation.js) contains 852 triangles
 * as a flat array of vertex indices [a, b, c, a, b, c, ...].
 * Each index refers to a keypoint in face.keypoints[].
 *
 * Press W — wireframe mesh
 * Press T — video texture mapped onto the mesh
 * Press I — custom image texture (set customTexture in preload)
 */

let faceMesh;
let video;
let faces = [];
let options = { maxFaces: 1, refineLandmarks: false, flipHorizontal: false };

// Display mode: 'mesh' | 'texture' | 'image'
let displayMode = "mesh";

// ── Texture framework ─────────────────────────────────────────────────────────
// To use a custom image texture, load it in preload() and assign to this variable.
// The image will be UV-mapped onto the face mesh using the keypoint positions.
let customTexture = null;
// Example:  customTexture = loadImage('mask.png');
// ─────────────────────────────────────────────────────────────────────────────

// 2D graphics buffer used for the HUD — text() requires a font in WEBGL mode,
// so we draw all text into a plain 2D layer and composite it as an image.
let hud;

function preload() {
  faceMesh = ml5.faceMesh(options);
  // Uncomment to load a custom texture image:
  customTexture = loadImage("face.jpg");
}

function setup() {
  // WEBGL mode is required for UV-mapped texture triangles
  createCanvas(640, 480, WEBGL);
  // NORMAL mode: UV coordinates are in [0, 1] range
  textureMode(NORMAL);
  // 2D graphics buffer for the HUD text overlay
  hud = createGraphics(640, 480);
  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();
  faceMesh.detectStart(video, gotFaces);
}

function draw() {
  background(20);

  // In WEBGL mode the origin is canvas centre, so shift by half dimensions
  const cx = -width / 2;
  const cy = -height / 2;

  // Draw the live video feed as the background
  push();
  translate(cx, cy);
  //   image(video, 0, 0, width, height);
  pop();

  if (faces.length > 0) {
    let face = faces[0];

    if (displayMode === "mesh") {
      drawFaceMeshWireframe(face);
    } else if (displayMode === "texture") {
      // Sample the video at each keypoint's canvas position
      drawTexturedFaceMesh(face, video, "canvas");
    } else if (displayMode === "image") {
      // Stretch the image to fill the face bounding box
      // Falls back to video texture if no image is loaded
      drawTexturedFaceMesh(face, customTexture || video, "face");
    }
  }

  // HUD overlay — drawn into a 2D graphics buffer, then composited as an image
  hud.clear();
  hud.noStroke();
  hud.fill(0, 0, 0, 140);
  hud.rect(0, 0, width, 50);
  hud.fill(255);
  hud.textSize(13);
  hud.textFont("monospace");
  hud.text(
    "W  wireframe    T  video texture    I  image texture    mode: " +
      displayMode,
    10,
    20,
  );
  hud.text("faces detected: " + faces.length, 10, 38);
  push();
  translate(-width / 2, -height / 2);
  image(hud, 0, 0);
  pop();
}

// ── Mesh rendering ────────────────────────────────────────────────────────────

// Draw the triangulated face mesh as a green wireframe
function drawFaceMeshWireframe(face) {
  stroke(0, 220, 0, 200);
  strokeWeight(0.5);
  noFill();

  beginShape(TRIANGLES);
  for (let i = 0; i < TRIANGULATION.length; i += 3) {
    let kp0 = face.keypoints[TRIANGULATION[i]];
    let kp1 = face.keypoints[TRIANGULATION[i + 1]];
    let kp2 = face.keypoints[TRIANGULATION[i + 2]];
    if (kp0 && kp1 && kp2) {
      vertex(kp0.x - width / 2, kp0.y - height / 2);
      vertex(kp1.x - width / 2, kp1.y - height / 2);
      vertex(kp2.x - width / 2, kp2.y - height / 2);
    }
  }
  endShape();
}

// ── Texture framework ─────────────────────────────────────────────────────────
//
// Two UV strategies (textureMode is NORMAL so all UVs are in [0, 1]):
//
//   'canvas'  — UV = keypoint position relative to the canvas.
//               Used for video: samples the texture at the same pixel the
//               keypoint occupies, extracting the face from the live feed.
//
//   'face'    — UV = keypoint position relative to the face bounding box.
//               Used for images: stretches the image to fill the face area,
//               producing a mask/warp effect regardless of image size.
//
function drawTexturedFaceMesh(face, tex, uvMode = "canvas") {
  // Precompute face bounding box when needed for 'face' UV mode
  let minX, minY, faceW, faceH;
  if (uvMode === "face") {
    minX = Infinity;
    minY = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity;
    for (let kp of face.keypoints) {
      if (kp.x < minX) minX = kp.x;
      if (kp.x > maxX) maxX = kp.x;
      if (kp.y < minY) minY = kp.y;
      if (kp.y > maxY) maxY = kp.y;
    }
    faceW = maxX - minX || 1;
    faceH = maxY - minY || 1;
  }

  noStroke();
  texture(tex);

  beginShape(TRIANGLES);
  for (let i = 0; i < TRIANGULATION.length; i += 3) {
    let kp0 = face.keypoints[TRIANGULATION[i]];
    let kp1 = face.keypoints[TRIANGULATION[i + 1]];
    let kp2 = face.keypoints[TRIANGULATION[i + 2]];
    if (kp0 && kp1 && kp2) {
      let u0, v0, u1, v1, u2, v2;
      if (uvMode === "face") {
        // Normalise each keypoint within the face bounding box
        u0 = (kp0.x - minX) / faceW;
        v0 = (kp0.y - minY) / faceH;
        u1 = (kp1.x - minX) / faceW;
        v1 = (kp1.y - minY) / faceH;
        u2 = (kp2.x - minX) / faceW;
        v2 = (kp2.y - minY) / faceH;
      } else {
        // Normalise each keypoint within the canvas
        u0 = kp0.x / width;
        v0 = kp0.y / height;
        u1 = kp1.x / width;
        v1 = kp1.y / height;
        u2 = kp2.x / width;
        v2 = kp2.y / height;
      }
      vertex(kp0.x - width / 2, kp0.y - height / 2, 0, u0, v0);
      vertex(kp1.x - width / 2, kp1.y - height / 2, 0, u1, v1);
      vertex(kp2.x - width / 2, kp2.y - height / 2, 0, u2, v2);
    }
  }
  endShape();
}
// ─────────────────────────────────────────────────────────────────────────────

function keyPressed() {
  if (key === "w" || key === "W") displayMode = "mesh";
  if (key === "t" || key === "T") displayMode = "texture";
  if (key === "i" || key === "I") displayMode = "image";
}

// Callback function for when faceMesh outputs data
function gotFaces(results) {
  faces = results;
}
