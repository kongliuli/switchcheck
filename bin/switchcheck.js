#!/usr/bin/env node
'use strict';
// run() is async (remote scans over SSH await their collectors).
require('../src/cli').run(process.argv.slice(2)).then(code => { process.exitCode = code; });
