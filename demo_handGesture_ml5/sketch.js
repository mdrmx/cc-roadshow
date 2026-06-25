/*
 * Interactive Harp — ml5.js HandPose + p5.sound
 * 12 notes across A natural minor (A3–E5)
 * Move your index fingertip across any string to strum it.
 * Supports two hands simultaneously.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

// A natural minor scale, two octaves A3 → E5
const NOTES = [
  { name: "A3", freq: 220.0 },
  { name: "B3", freq: 246.94 },
  { name: "C4", freq: 261.63 },
  { name: "D4", freq: 293.66 },
  { name: "E4", freq: 329.63 },
  { name: "F4", freq: 349.23 },
  { name: "G4", freq: 392.0 },
  { name: "A4", freq: 440.0 },
  { name: "B4", freq: 493.88 },
  { name: "C5", freq: 523.25 },
  { name: "D5", freq: 587.33 },
  { name: "E5", freq: 659.25 },
];

const STRING_TOP = 75;
const STRING_BOTTOM = 400;
const MARGIN = 48;
const COOLDOWN_MS = 200; // min ms between strums on same string

// ── Globals ───────────────────────────────────────────────────────────────────

let handPose;
let video;
let hands = [];
let strings = [];
let prevPos = {}; // last mirrored index-tip {x,y} per hand, keyed by handedness

// ── ml5 preload ───────────────────────────────────────────────────────────────

function preload() {
  handPose = ml5.handPose({ maxHands: 2 });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

function setup() {
  createCanvas(640, 480);

  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  handPose.detectStart(video, gotHands);

  // Distribute 12 strings evenly across the canvas width
  const usable = width - MARGIN * 2;
  const spacing = usable / (NOTES.length - 1);
  for (let i = 0; i < NOTES.length; i++) {
    strings.push(
      new HarpString(MARGIN + i * spacing, NOTES[i].name, NOTES[i].freq),
    );
  }
}

// ── Draw ──────────────────────────────────────────────────────────────────────

function draw() {
  background(8, 6, 22);

  // Dim mirrored webcam feed for ambiance
  push();
  tint(255, 55);
  translate(width, 0);
  scale(-1, 1);
  image(video, 0, 0, width, height);
  pop();
  noTint();

  drawHarpFrame();

  for (let s of strings) {
    s.update();
    s.draw();
  }

  processHands();
  drawHints();
}

// ── Hand processing ───────────────────────────────────────────────────────────

function processHands() {
  if (hands.length === 0) {
    prevPos = {};
    return;
  }

  for (let h = 0; h < hands.length; h++) {
    const hand = hands[h];
    const key = hand.handedness || String(h); // 'Left' | 'Right'

    // Keypoint 8 = index fingertip
    const tip = hand.keypoints[8];
    if (!tip) continue;

    // Mirror x to match the horizontally-flipped display
    const mx = width - tip.x;
    const my = tip.y;

    drawFingerTip(mx, my);

    if (prevPos[key]) {
      const px = prevPos[key].x;
      const py = prevPos[key].y;

      const inRange = my >= STRING_TOP && my <= STRING_BOTTOM;
      const wasInRange = py >= STRING_TOP && py <= STRING_BOTTOM;

      if (inRange || wasInRange) {
        for (const s of strings) {
          // Trigger strum when the fingertip crosses this string's x position
          if ((px <= s.x && mx > s.x) || (px >= s.x && mx < s.x)) {
            s.strum();
          }
        }
      }
    }

    prevPos[key] = { x: mx, y: my };
  }
}

// ── Visual helpers ────────────────────────────────────────────────────────────

function drawFingerTip(x, y) {
  noStroke();
  fill(255, 70, 100, 130);
  circle(x, y, 28);
  fill(255, 170, 185);
  circle(x, y, 10);
}

function drawHarpFrame() {
  // Thick wood-tone horizontal bars at top and bottom of the string area
  strokeWeight(16);
  stroke(110, 75, 38);
  line(MARGIN - 14, STRING_TOP, width - MARGIN + 14, STRING_TOP);
  line(MARGIN - 14, STRING_BOTTOM, width - MARGIN + 14, STRING_BOTTOM);

  // Subtle highlight on each bar
  strokeWeight(2);
  stroke(210, 165, 80, 90);
  line(MARGIN - 14, STRING_TOP - 6, width - MARGIN + 14, STRING_TOP - 6);
  line(MARGIN - 14, STRING_BOTTOM + 6, width - MARGIN + 14, STRING_BOTTOM + 6);
}

function drawHints() {
  noStroke();
  fill(155, 130, 75, 155);
  textAlign(CENTER, BOTTOM);
  textSize(12);
  text(
    "move index finger across the strings to play  •  click to enable audio",
    width / 2,
    height - 8,
  );
}

// ── Audio unlock on first user gesture ───────────────────────────────────────

function mousePressed() {
  userStartAudio();
}
function touchStarted() {
  userStartAudio();
}

// ── ml5 callback ─────────────────────────────────────────────────────────────

function gotHands(results) {
  hands = results;
}

// ── HarpString class ──────────────────────────────────────────────────────────

class HarpString {
  constructor(x, noteName, freq) {
    this.x = x;
    this.noteName = noteName;
    this.freq = freq;

    // Vibration state
    this.vibPhase = 0;
    this.vibAmp = 0;
    this.vibrating = false;

    // Strum cooldown
    this.lastStrum = 0;

    // p5.sound objects — lazily created after the first user gesture
    this.osc = null;
    this.env = null;
  }

  // Initialise audio objects (safe to call multiple times)
  _initAudio() {
    if (this.osc) return;
    this.osc = new p5.Oscillator("triangle");
    this.osc.freq(this.freq);
    this.osc.amp(0);
    this.osc.start();

    this.env = new p5.Envelope();
    // Fast attack, medium decay, low sustain, long release → plucked string feel
    this.env.setADSR(0.001, 0.5, 0.05, 2.0);
    this.env.setRange(0.6, 0);
  }

  strum() {
    const now = millis();
    if (now - this.lastStrum < COOLDOWN_MS) return;
    this.lastStrum = now;

    this._initAudio();
    this.env.play(this.osc);

    // Kick off visual vibration
    this.vibrating = true;
    this.vibAmp = 8;
    this.vibPhase = random(TWO_PI); // random start phase for variety
  }

  update() {
    if (!this.vibrating) return;
    // Phase speed scales with pitch so higher strings oscillate faster
    this.vibPhase += map(this.freq, 220, 659, 0.12, 0.3);
    this.vibAmp *= 0.965; // exponential decay — faster decay = higher tension
    if (this.vibAmp < 0.3) {
      this.vibrating = false;
      this.vibAmp = 0;
    }
  }

  draw() {
    noFill();

    if (this.vibrating) {
      // Outer glow pass
      stroke(255, 215, 60, 50);
      strokeWeight(11);
      this._wavePath();

      // Bright main string
      stroke(255, 238, 120);
      strokeWeight(2.5);
      this._wavePath();
    } else {
      // Resting string
      stroke(170, 138, 52, 185);
      strokeWeight(1.5);
      line(this.x, STRING_TOP, this.x, STRING_BOTTOM);
    }

    // Anchor pegs at top and bottom
    noStroke();
    fill(this.vibrating ? color(255, 228, 100) : color(125, 95, 40));
    circle(this.x, STRING_TOP, 7);
    circle(this.x, STRING_BOTTOM, 7);

    // Note name label beneath bottom peg
    fill(this.vibrating ? color(255, 248, 160) : color(155, 125, 58, 165));
    textAlign(CENTER, TOP);
    textSize(10);
    text(this.noteName, this.x, STRING_BOTTOM + 10);
  }

  // Draws the string shape — straight when at rest, wavy when vibrating.
  // Uses a two-harmonic standing wave fixed at both endpoints.
  _wavePath() {
    const SEGS = 50;
    beginShape();
    for (let i = 0; i <= SEGS; i++) {
      const t = i / SEGS;
      const y = lerp(STRING_TOP, STRING_BOTTOM, t);

      // Fundamental: sin(πt) envelope × cos(phase)  — zero at both ends
      const h1 = sin(PI * t) * cos(this.vibPhase);
      // Second harmonic (smaller amplitude)
      const h2 = sin(2 * PI * t) * cos(2 * this.vibPhase + 0.4);

      const xOff = this.vibAmp * (h1 + 0.25 * h2);
      vertex(this.x + xOff, y);
    }
    endShape();
  }
}
``;
