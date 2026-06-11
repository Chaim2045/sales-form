/* ============================================================================
   Login background collage — generated, not hand-written.
   Builds 7 vertical "drift" tracks. Each track is a set of dashboard thumbnails
   duplicated ONCE (byte-identical copy) so the CSS `translateY(-50%)` loop is
   perfectly seamless. PER_TRACK is sized so one copy is taller than any realistic
   viewport → the loop never reveals a gap.

   Decorative only: the container is aria-hidden. If JS is disabled the navy
   gradient background shows on its own — an acceptable, intentional fallback.
   ============================================================================ */
(function () {
  var collage = document.querySelector('.lg-collage');
  if (!collage || collage.children.length) return;   // no-op if already populated

  var TRACKS = 7;
  var IMAGES = 7;        // assets/login-col-1..7.png
  var PER_TRACK = 7;     // 7 imgs × 2 copies = 14 → one copy ≈ 1.6–1.8× viewport tall

  var frag = document.createDocumentFragment();

  for (var t = 0; t < TRACKS; t++) {
    var track = document.createElement('div');
    track.className = 'lg-track';

    // build one "set", then append it twice (clone) → seamless duplicate
    var set = document.createDocumentFragment();
    for (var i = 0; i < PER_TRACK; i++) {
      var n = ((t * 3 + i) % IMAGES) + 1;             // shuffle so neighbours differ
      var img = document.createElement('img');
      img.src = 'assets/login-col-' + n + '.png';
      img.alt = '';
      img.className = 'lg-col';
      img.decoding = 'async';                          // don't block the main thread
      set.appendChild(img);
    }
    track.appendChild(set.cloneNode(true));            // copy A
    track.appendChild(set.cloneNode(true));            // copy B (identical → no seam)
    frag.appendChild(track);
  }

  collage.appendChild(frag);
})();
