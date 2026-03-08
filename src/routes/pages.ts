import { Hono } from 'hono';
import { serveIndex } from '../app.js';

export const pages = new Hono();

// Serve index.html for all page routes (SPA routing)
pages.get('/', (c) => {
  return c.html(serveIndex());
});

pages.get('/sessions', (c) => {
  return c.html(serveIndex());
});

pages.get('/gateway', (c) => {
  return c.html(serveIndex());
});

pages.get('/session/:key', (c) => {
  return c.html(serveIndex());
});

pages.get('/projects', (c) => {
  return c.html(serveIndex());
});

pages.get('/projects-manage', (c) => {
  return c.html(serveIndex());
});
