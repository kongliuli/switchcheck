#!/usr/bin/env node
'use strict';
process.exitCode = require('../src/cli').run(process.argv.slice(2));
