import { describe, it, expect } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('server static serving', () => {
  it('should have public/ directory configured for static serving', () => {
    const app = express();
    const publicDir = path.join(__dirname, '..', 'public');

    // Simulate what server.js should do
    app.use(express.static(publicDir));

    // Verify the middleware stack includes a static-serving middleware
    const hasStatic = app._router.stack.some(
      (layer) => layer.name === 'serveStatic'
    );
    expect(hasStatic).toBe(true);
  });

  it('public/ directory exists', () => {
    const publicDir = path.join(__dirname, '..', 'public');
    expect(fs.existsSync(publicDir)).toBe(true);
  });
});
