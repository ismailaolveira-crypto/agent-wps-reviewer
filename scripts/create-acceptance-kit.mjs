#!/usr/bin/env node
import { createAcceptanceKit } from '../src/acceptance/kit.mjs';

const result = await createAcceptanceKit();
console.log(JSON.stringify(result, null, 2));
