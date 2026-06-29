////////////////////////////////////////////////////////
// ML5 BodyPose + p5.js + WebGL Starfield Constellation Demo
// by Stuart D. Haffenden Cornejo
/////////////////////////////////////////////////////////

// ML5 exposes the MoveNet model to P5.js.
// MoveNet uses 17 keypoints (nose, eyes, ears, shoulders, elbows, wrists, hips, knees, ankles)
// to track human poses in real-time. This demo uses the keypoints to light up individual stars
// in the starfield and draw constellation lines between them.

// --global variables--
let video;
let bodyPose;
let poses = [];
let connections;

// --constants--
const NUM_STARS = 300;
const ACTIVATION_RADIUS_SQ = 150 * 150; // compare squared distances — avoids sqrt()
const MAX_KEYPOINTS = 17; // MoveNet has 17 keypoints
const MAX_POSES = 2;

// optimisation using typed arrays and pre-rendered buffers to improve performance
// Star data in typed arrays — better cache locality than array-of-objects
let starX, starY, starSize, starBrightness;
let activeFlag; // Uint8Array: 1 if star is lit this frame, 0 otherwise
let kpToStarMaps; // flat Int32Array [pose0_kp0, pose0_kp1, ..., pose1_kp0, ...]
let numActivePoses = 0;

// Pre-rendered offscreen buffers — draw once in setup, blit each frame
let starBuffer; // dim starfield (all 150 stars at rest brightness)
let glowSprite; // 128×128 normalised glow disc, scaled per active star

function preload() {
  bodyPose = ml5.bodyPose();
}

function setup() {
  createCanvas(640, 480);
  pixelDensity(1); //optimisation for performance on high-DPI displays

  //video config
  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  // Start bodypose detection
  bodyPose.detectStart(video, gotPoses);
  connections = bodyPose.getSkeleton();

  // Allocate typed arrays
  starX = new Float32Array(NUM_STARS);
  starY = new Float32Array(NUM_STARS);
  starSize = new Float32Array(NUM_STARS);
  starBrightness = new Float32Array(NUM_STARS);
  activeFlag = new Uint8Array(NUM_STARS);
  kpToStarMaps = new Int32Array(MAX_POSES * MAX_KEYPOINTS);

  for (let i = 0; i < NUM_STARS; i++) {
    starX[i] = random(width);
    starY[i] = random(height);
    starSize[i] = random(1, 3.5);
    starBrightness[i] = random(110, 210);
  }

  // Pre-render dim starfield — one image() blit replaces 150 circle() calls per frame
  starBuffer = createGraphics(width, height);
  starBuffer.noStroke();
  for (let i = 0; i < NUM_STARS; i++) {
    let b = starBrightness[i];
    starBuffer.fill(b * 0.88, b * 0.92, b);
    starBuffer.circle(starX[i], starY[i], starSize[i]);
  }

  // Pre-render glow sprite at 128×128 — one drawImage replaces 4 fill+circle calls per active star
  glowSprite = createGraphics(128, 128);
  let gCtx = glowSprite.drawingContext;
  let grad = gCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.15, "rgba(220,240,255,0.85)");
  grad.addColorStop(0.4, "rgba(140,200,255,0.35)");
  grad.addColorStop(1, "rgba(80,140,255,0)");
  gCtx.fillStyle = grad;
  gCtx.beginPath();
  gCtx.arc(64, 64, 64, 0, Math.PI * 2);
  gCtx.fill();
}

function draw() {
  let t = frameCount * 0.025;

  background(5, 8, 25);

  push();

  translate(width, 0);
  // Scale -1 in the x-axis to flip the image horizontally
  scale(-1, 1);

  // --- Reset per-frame state (typed array .fill is fast) ---
  activeFlag.fill(0);
  kpToStarMaps.fill(-1);

  // --- Find nearest star for each confident keypoint (squared distance, no sqrt) ---
  let n = min(poses.length, MAX_POSES);
  for (let i = 0; i < n; i++) {
    let kps = poses[i].keypoints; //get keypoints for this pose
    let base = i * MAX_KEYPOINTS; // offset into flat kpToStarMaps array
    for (let j = 0; j < kps.length; j++) {
      let kp = kps[j]; // keypoint object has {x, y, confidence}
      if (kp.confidence > 0.1) {
        // only consider keypoints with confidence > 0.1
        let kpx = kp.x,
          kpy = kp.y;
        let minDSq = ACTIVATION_RADIUS_SQ;
        let nearest = -1; // index of nearest star within activation radius
        for (let s = 0; s < NUM_STARS; s++) {
          let dx = kpx - starX[s];
          let dy = kpy - starY[s];
          let dSq = dx * dx + dy * dy; // squared distance to star
          if (dSq < minDSq) {
            minDSq = dSq; // update nearest star if within activation radius
            nearest = s; // store index of nearest star
          }
        }
        // If a nearest star was found, map this keypoint to that star and mark it as active
        if (nearest !== -1) {
          kpToStarMaps[base + j] = nearest; // map keypoint to nearest star
          activeFlag[nearest] = 1; // mark star as active for this frame
        }
      }
    }
  }
  numActivePoses = n;

  // --- Dim starfield: one image blit with global twinkle via tint ---
  let globalTwinkle = sin(t) * 0.12 + 0.88; // 0.76 – 1.0
  tint(255, globalTwinkle * 255);
  image(starBuffer, 0, 0);
  noTint();

  // --- Constellation lines: one batched canvas path per pose ---
  let ctx = drawingContext;
  let linePulse = 180; // 100 – 180
  ctx.lineWidth = 1.2;
  for (let i = 0; i < numActivePoses; i++) {
    let base = i * MAX_KEYPOINTS;
    ctx.beginPath();
    ctx.strokeStyle = `rgba(160,210,255,${(linePulse / 255).toFixed(3)})`;
    for (let j = 0; j < connections.length; j++) {
      let sA = kpToStarMaps[base + connections[j][0]];
      let sB = kpToStarMaps[base + connections[j][1]];
      if (sA !== -1 && sB !== -1) {
        ctx.moveTo(starX[sA], starY[sA]);
        ctx.lineTo(starX[sB], starY[sB]);
      }
    }
    ctx.stroke();
  }

  // --- Active star glows: blit pre-rendered sprite scaled to each star ---
  let pulse = sin(t * 3) * 0.15 + 1.0; // 0.85 – 1.15, one value for all active stars
  for (let i = 0; i < NUM_STARS; i++) {
    if (activeFlag[i]) {
      let diameter = starSize[i] * 13;
      let r = diameter * 0.5;
      image(glowSprite, starX[i] - r, starY[i] - r, diameter, diameter);
    }
  }
  pop();
}

function gotPoses(results) {
  poses = results;
}
