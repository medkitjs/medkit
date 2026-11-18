<?php
// The partials are written by `node render.js`; readfile() outputs them as
// they are, so nothing in them ever runs as PHP.
function partial(string $name): void
{
    readfile(__DIR__ . "/../partials/{$name}.html");
}
?>
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>medkit with PHP</title>
    <meta name="description" content="medkit's image, background video and player in a plain PHP page, rendered into partials at build time.">
    <style>
      body { margin: 0; font: 1.125rem/1.5 system-ui, sans-serif; color: #111; }
      main { max-width: 720px; margin: 0 auto; padding: 1rem; }
      h1 { margin: 0; padding: 30vh 1rem 1rem; color: #fff; font-size: clamp(2rem, 6vw, 3.5rem); }
    </style>
    <script type="module" src="/medkit/image.js"></script>
    <script type="module" src="/medkit/video-bg.js"></script>
    <script type="module" src="/medkit/player.js"></script>
  </head>
  <body>
    <header><?php partial('hero'); ?></header>
    <main>
      <h2>An image</h2>
      <?php partial('lake'); ?>
      <h2>A video with sound and captions</h2>
      <?php partial('talk'); ?>
    </main>
  </body>
</html>
