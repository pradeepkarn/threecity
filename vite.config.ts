import { defineConfig } from 'vite';
import { writeFileSync } from 'fs';

// Adds one small endpoint to the dev server: the planner (planner.html) POSTs the edited city
// plan here, and it's written to src/world/cityPlan.json. Vite then reloads the game with it.
// This only exists during `npm run dev`; the built game never includes it.
export default defineConfig({
  plugins: [
    {
      name: 'save-city-plan',
      configureServer(server) {
        server.middlewares.use('/__save-plan', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return;
          }
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            try {
              JSON.parse(body); // refuse to save anything that isn't valid JSON
              writeFileSync('src/world/cityPlan.json', body);
              res.end('saved');
            } catch (error) {
              res.statusCode = 400;
              res.end(String(error));
            }
          });
        });
      },
    },
  ],
});
