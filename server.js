// Rebus render service for Railway
const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = express();
const upload = multer({ dest: os.tmpdir() });

const CANVAS_W = 900;
const CANVAS_H = 1600;
const IMG_SIZE = 300;
const GAP = 15;
const DIGIT_FONT = 110;
const DIGIT_COLOR = 'D00000';
const DIGIT_CHAR_W = 58;
const ANSWER_FONT = 120;
const ANSWER_COLOR = '1E7A1E';
const ANSWER_Y = 1000;
const ROW1_CY = 451;
const ROW2_CY = 751;
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

function layoutRow(cut, digitStr, rowCy) {
  const digitW = String(digitStr).length * DIGIT_CHAR_W;
  const unitW = IMG_SIZE + GAP + digitW;
  const left = Math.round((CANVAS_W - unitW) / 2);
  let imgX, digitX;
  if (cut === 'suffix') {
    digitX = left;
    imgX = left + digitW + GAP;
  } else {
    imgX = left;
    digitX = left + IMG_SIZE + GAP;
  }
  const imgY = Math.round(rowCy - IMG_SIZE / 2);
  const digitY = Math.round(rowCy - DIGIT_FONT / 2);
  return { imgX, imgY, digitX, digitY };
}

function esc(t) {
  return String(t).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

app.get('/', (_req, res) => res.send('rebus render ok'));

app.post('/render', upload.fields([
  { name: 'fon', maxCount: 1 },
  { name: 'img1', maxCount: 1 },
  { name: 'img2', maxCount: 1 },
]), (req, res) => {
  let payload;
  try { payload = JSON.parse(req.body.payload || '{}'); }
  catch (e) { return res.status(400).json({ error: 'bad payload json' }); }

  const fon = req.files?.fon?.[0];
  const img1 = req.files?.img1?.[0];
  const img2 = req.files?.img2?.[0];
  if (!fon || !img1 || !img2) return res.status(400).json({ error: 'missing fon/img1/img2' });

  const t = payload.timings || {};
  const start = Number(t.start ?? 2);
  const step = Number(t.step ?? 0.3);
  const answerReveal = Number(t.answer_reveal ?? 13.2);
  const duration = Number(t.duration ?? 15);

  const tImg1 = start;
  const tDig1 = start + step;
  const tImg2 = start + step * 2;
  const tDig2 = start + step * 3;

  const r1 = layoutRow(payload.cut1, payload.digit1, ROW1_CY);
  const r2 = layoutRow(payload.cut2, payload.digit2, ROW2_CY);

  const digit1 = esc(payload.digit1);
  const digit2 = esc(payload.digit2);
  const answer = esc(payload.answer);

  const out = path.join(os.tmpdir(), `rebus_${Date.now()}.mp4`);

  const filter = [
    `[0:v]scale=${CANVAS_W}:${CANVAS_H},setsar=1,trim=0:${duration},setpts=PTS-STARTPTS[bg]`,
    `[1:v]scale=${IMG_SIZE}:${IMG_SIZE}[i1]`,
    `[2:v]scale=${IMG_SIZE}:${IMG_SIZE}[i2]`,
    `[bg][i1]overlay=x=${r1.imgX}:y=${r1.imgY}:enable='gte(t,${tImg1})'[o1]`,
    `[o1][i2]overlay=x=${r2.imgX}:y=${r2.imgY}:enable='gte(t,${tImg2})'[o2]`,
    `[o2]drawtext=fontfile=${FONT}:text='${digit1}':fontsize=${DIGIT_FONT}:fontcolor=0x${DIGIT_COLOR}:x=${r1.digitX}:y=${r1.digitY}:enable='gte(t,${tDig1})'[o3]`,
    `[o3]drawtext=fontfile=${FONT}:text='${digit2}':fontsize=${DIGIT_FONT}:fontcolor=0x${DIGIT_COLOR}:x=${r2.digitX}:y=${r2.digitY}:enable='gte(t,${tDig2})'[o4]`,
    `[o4]drawtext=fontfile=${FONT}:text='${answer}':fontsize=${ANSWER_FONT}:fontcolor=0x${ANSWER_COLOR}:x=(w-text_w)/2:y=${ANSWER_Y}:enable='gte(t,${answerReveal})'[vout]`,
  ].join(';');

  const args = [
    '-y', '-i', fon.path, '-i', img1.path, '-i', img2.path,
    '-filter_complex', filter,
    '-map', '[vout]', '-map', '0:a?',
    '-t', String(duration), '-r', '30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast',
    '-c:a', 'aac', '-shortest', out,
  ];

  const ff = spawn('ffmpeg', args);
  let errLog = '';
  ff.stderr.on('data', (d) => { errLog += d.toString(); });
  ff.on('close', (code) => {
    const cleanup = () => {
      [fon, img1, img2].forEach((f) => { try { fs.unlinkSync(f.path); } catch (_) {} });
      try { fs.unlinkSync(out); } catch (_) {}
    };
    if (code !== 0) {
      cleanup();
      console.error(errLog);
      return res.status(500).json({ error: 'ffmpeg failed', detail: errLog.slice(-2000) });
    }
    res.setHeader('Content-Type', 'video/mp4');
    const stream = fs.createReadStream(out);
    stream.pipe(res);
    stream.on('close', cleanup);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`rebus render on ${PORT}`));
