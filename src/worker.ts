import { exec } from 'child_process';
import worker from 'worker_threads';
import fileType from 'file-type';
import puppeteer from 'puppeteer';
import { unlink } from 'fs/promises';

let timeout: NodeJS.Timer = null;

function restartTimeout(browser: puppeteer.Browser | null) {
  if (timeout !== null) clearTimeout(timeout);
  timeout = setTimeout(() => {
    if (browser !== null) browser.close();
    worker.parentPort.postMessage(408);
    process.exit(1);
  }, 15e3);
}

if (worker.isMainThread) throw new Error("can't be ran as main thread");
(async function () {
  try {
    let a = await fileType.fromFile(
      `/var/www-uploads/${worker.workerData.file}`
    );
    if (a === undefined && !worker.workerData.file.match(/\.html?$/)) {
      worker.parentPort.postMessage(415);
      process.exit(0);
    }
    if (worker.workerData.file.match(/\.html?$/)) {
      const browser = await puppeteer.launch(),
        page = await browser.newPage();
      page.setViewport({ width: 256, height: 256 });
      restartTimeout(browser);
      await page.goto(`file:///var/www-uploads/${worker.workerData.file}`, {
        waitUntil: 'networkidle2'
      });
      await page.screenshot({
        path: `/tmp/cumulonimbus-preview-cache/${worker.workerData.file}.webp`
      });
      restartTimeout(browser);
      exec(
        `chmod +r+w /tmp/cumulonimbus-preview-cache/${worker.workerData.file}.webp`,
        (error, stdout, stderr) => {
          if (error) {
            worker.parentPort.postMessage(500);
            console.error(error, stderr, stdout);
            process.exit(0);
          } else {
            worker.parentPort.postMessage(200);
            process.exit(0);
          }
        }
      );
    } else if (a.mime.startsWith('video') || a.mime.startsWith('image')) {
      restartTimeout(null);
      exec(
        `ffmpeg -i /var/www-uploads/${worker.workerData.file} -vf 'scale=256:256:force_original_aspect_ratio=1,format=rgba,pad=256:256:(ow-iw)/2:(oh-ih)/2:color=#00000000' -vframes 1 /tmp/cumulonimbus-preview-cache/${worker.workerData.file}.webp`,
        (error, stdout, stderr) => {
          if (error) {
            worker.parentPort.postMessage(500);
            console.error(error, stderr, stdout);
            process.exit(0);
          } else {
            worker.parentPort.postMessage(200);
            process.exit(0);
          }
        }
      );
    } else if (a.mime === 'application/pdf') {
      restartTimeout(null);
      exec(
        `pdftoppm -singlefile -png -x 0 -y 0 -W 256 -H 256 -scale-to 256 /var/www-uploads/${worker.workerData.file} /tmp/${worker.workerData.file}`,
        (error, stdout, stderr) => {
          if (error) {
            worker.parentPort.postMessage(500);
            console.error(error, stderr, stdout);
            process.exit(0);
          } else {
            restartTimeout(null);
            exec(
              `ffmpeg -i /tmp/${worker.workerData.file}.png -vf 'scale=256:256:force_original_aspect_ratio=1,format=rgba,pad=256:256:(ow-iw)/2:(oh-ih)/2:color=#00000000' -vframes 1 /tmp/cumulonimbus-preview-cache/${worker.workerData.file}.webp`,
              async (error, stdout, stderr) => {
                if (error) {
                  worker.parentPort.postMessage(500);
                  console.error(error, stderr, stdout);
                  process.exit(0);
                } else {
                  await unlink(`/tmp/${worker.workerData.file}.png`);
                  worker.parentPort.postMessage(200);
                  process.exit(0);
                }
              }
            );
          }
        }
      );
    } else if (a.mime.startsWith('font')) {
      const browser = await puppeteer.launch(),
        page = await browser.newPage();
      page.setViewport({ width: 256, height: 256 });
      restartTimeout(browser);
      await page.goto(
        `file://${process.cwd()}/font-renderer.html?font=${
          worker.workerData.file
        }`,
        {
          waitUntil: 'load'
        }
      );
      restartTimeout(browser);
      await page.screenshot({
        path: `/tmp/cumulonimbus-preview-cache/${worker.workerData.file}.webp`
      });
      worker.parentPort.postMessage(200);
      process.exit(0);
    } else {
      worker.parentPort.postMessage(415);
      process.exit(0);
    }
  } catch (e) {
    worker.parentPort.postMessage(500);
    console.error(e);
    process.exit(0);
  }
})();
