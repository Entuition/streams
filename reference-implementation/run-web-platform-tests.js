// This runs the web platform tests against the reference implementation, in Node.js using jsdom, for easier rapid
// development of the reference implementation and the web platform tests.
/* eslint-disable no-console */
'use strict';
const path = require('path');
const { promisify } = require('util');
const browserify = require('browserify');
const wptRunner = require('wpt-runner');
const minimatch = require('minimatch');

// wpt-runner does not yet support unhandled rejection tracking a la
// https://github.com/w3c/testharness.js/commit/7716e2581a86dfd9405a9c00547a7504f0c7fe94
// So we emulate it with Node.js events
const rejections = new Map();
process.on('unhandledRejection', (reason, promise) => {
  rejections.set(promise, reason);
});

process.on('rejectionHandled', promise => {
  rejections.delete(promise);
});

main().catch(e => {
  console.error(e.stack);
  process.exitCode = 1;
});

async function main() {
  const entryPath = path.resolve(__dirname, 'lib/index.js');
  const testsPath = path.resolve(__dirname, 'web-platform-tests/streams');

  const filterGlobs = process.argv.length >= 3 ? process.argv.slice(2) : ['**/*.html'];
  const workerTestPattern = /\.(?:dedicated|shared|service)worker(?:\.https)?\.html$/;

  const bundledJS = await bundle(entryPath);

  const failures = await wptRunner(testsPath, {
    rootURL: 'streams/',
    setup(window) {
      window.queueMicrotask = queueMicrotask;
      window.eval(bundledJS);
    },
    filter(testPath) {
      return !workerTestPattern.test(testPath) && // ignore the worker versions
              filterGlobs.some(glob => minimatch(testPath, glob));
    }
  });

  process.exitCode = failures;

  if (rejections.size > 0) {
    if (failures === 0) {
      process.exitCode = 1;
    }

    for (const reason of rejections.values()) {
      console.error('Unhandled promise rejection: ', reason.stack);
    }
  }
}

async function bundle(entryPath) {
  const b = browserify([entryPath]);
  const buffer = await promisify(b.bundle.bind(b))();
  return buffer.toString();
}
