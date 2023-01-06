import { existsSync, mkdirSync, readFileSync, createReadStream } from 'node:fs';
import worker from 'node:worker_threads';
import fastify from 'fastify';
import Logger, { Level } from './Logger';
import { resolve } from 'node:path';
import compression, { filter as _filter } from 'compression';
const packageJSON = JSON.parse(readFileSync('./package.json', 'utf8'));

global.console = new Logger(
  process.env.DEBUG ? Level.DEBUG : Level.INFO
) as any;

/* function shouldCompress(req: Express.Request, res: Express.Response): boolean {
  if (req.headers['x-no-compression']) {
    return false;
  }
} Not sure how to implement */

const port: number =
  8100 + (!process.env.instance ? 0 : Number(process.env.instance));
const app = fastify();

//app.use(compression({ filter: shouldCompress })); Not sure how to implement

if (!existsSync('/tmp/cumulonimbus-preview-cache'))
  mkdirSync('/tmp/cumulonimbus-preview-cache');

app.all('/', async (req, reply) => {
  reply.type("application/json").code(200);
  return { hello: 'world', version: packageJSON.version }
});

app.addHook("preHandler", (req, reply, done) => {
  reply.header("Server", `Cumulonimbus Thumbnailer/${packageJSON.version}`);
  done();
});

app.get('/:file', async (req, reply) => {
  if (existsSync(`/tmp/cumulonimbus-preview-cache/${req.params.file}.webp`)) {
    console.debug(
      `Preview cached for ${req.params.file}, not generating another.`
    );
    reply.header("Content-Type", "image/webp");
    return reply.send(createReadStream(resolve(`/tmp/cumulonimbus-preview-cache/${req.params.file}.webp`)));
  }
  if (!existsSync(`/var/www-uploads/${req.params.file}`)) {
    console.debug('File does not exist. File: %s', req.params.file);
    reply.code(404);
    return;
  }
  let thumbWorker = new worker.Worker('./dist/worker.js', {
    workerData: {
      file: req.params.file
    }
  });
  thumbWorker.on('online', () => {
    console.debug(`Generating preview for ${req.params.file}...`);
  });
  thumbWorker.on('exit', code => {
    if (code === 0)
      console.debug(`Done generating preview for ${req.params.file}.`);
    else console.debug(`Unable to generate preview for ${req.params.file}`);
  });
  thumbWorker.on('message', (status: number) => {
    if (status !== 200) {
      reply.code(status);
      return;
    } else {
      reply.header("Content-Type", "image/webp");
      return reply.send(createReadStream(resolve(`/tmp/cumulonimbus-preview-cache/${req.params.file}.webp`)));
    }
  });
});

app.listen({ port: port }, () => { console.log(`Listening on port ${port}.`); });
