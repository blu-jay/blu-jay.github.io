// Channel switching, sound, the on-screen clock, and fit-to-window scaling for the TV.
(function () {
  const pad = (n, fill = '0') => String(n).padStart(2, fill);
  const root = document.documentElement;
  const tv = document.querySelector('.tv');
  const power = document.getElementById('switch');
  const screen = document.querySelector('.screen');
  const phoneLayout = window.matchMedia('(max-width: 720px)');
  const pages = Array.from(document.querySelectorAll('.page')); // index = channel number
  const GUIDE = 0;
  const HOME = GUIDE; // where a visit starts, and what the set comes on to, unless the URL says otherwise
  const osd = document.querySelector('.osd');
  const marquee = document.querySelector('.marquee');
  const marqueeText = document.querySelector('.marquee-text');
  const snow = document.querySelector('.snow');
  const picture = document.querySelector('.contents');
  const clockTime = document.getElementById('clock-time');
  const clockDate = document.getElementById('clock-date');
  let current = HOME;
  let lastChannel = 1; // the last channel that wasn't the guide, for its highlight and for GUIDE
  let previousChannel = null; // the channel before this one, for BACK

  // ---------- pages ----------

  function show(index) {
    current = (index + pages.length) % pages.length;
    const page = pages[current];
    pages.forEach((p, i) => p.classList.toggle('active', i === current));
    picture.classList.toggle('own-chrome', page.hasAttribute('data-own-chrome'));
    closeClue(false);
    if (current === GUIDE) selectListing(lastChannel);
    else lastChannel = current;
    const url = current === HOME ? location.pathname + location.search : '#' + page.dataset.slug;
    history.replaceState(null, '', url);
  }

  function indexOfSlug(slug) {
    return pages.findIndex(p => p.dataset.slug === slug);
  }

  function hashIndex() {
    const index = indexOfSlug(decodeURIComponent(location.hash.slice(1)));
    return index < 0 ? HOME : index;
  }

  // ---------- channel 00: program guide ----------

  const listings = Array.from(document.querySelectorAll('.epg-cell'));
  const infoTitle = document.querySelector('.epg-info-title');
  const infoChannel = document.querySelector('.epg-info-ch');
  const infoTime = document.querySelector('.epg-info-time');
  const infoDesc = document.querySelector('.epg-info-desc');
  const preview = document.querySelector('.epg-preview');
  const epgTime = document.getElementById('epg-time');
  const epgSlots = Array.from(document.querySelectorAll('.epg-slot'));

  // Highlight a listing (a cell, or a channel's first cell) and show its details,
  // with a live, scaled-down copy of that channel in the preview window.
  function selectListing(target) {
    const cell = typeof target === 'number' ? listings.find(c => Number(c.dataset.channel) === target) : target;
    if (!cell) return;
    const channel = Number(cell.dataset.channel);
    listings.forEach(c => c.classList.toggle('selected', c === cell));
    infoTitle.textContent = cell.dataset.title;
    // The call sign is its own element: phones have no room for it.
    const call = document.createElement('span');
    call.className = 'epg-call';
    call.textContent = ' ' + cell.dataset.call;
    infoChannel.replaceChildren(pad(channel), call);
    infoTime.textContent = cell.dataset.time;
    infoDesc.textContent = cell.dataset.desc;
    if (preview.dataset.channel !== String(channel)) {
      preview.dataset.channel = channel;
      const copy = document.createElement('div');
      copy.className = 'epg-preview-screen';
      copy.append(pages[channel].cloneNode(true)); // the page only: the channel logo would sit on top of it
      preview.replaceChildren(copy);
    }
  }

  listings.forEach(cell => {
    cell.addEventListener('mouseenter', () => selectListing(cell));
    cell.addEventListener('focus', () => selectListing(cell));
    cell.addEventListener('click', () => tune(Number(cell.dataset.channel)));
  });

  // Up/down move through the listings while the guide is on screen.
  function moveListing(step) {
    const selected = listings.find(c => c.classList.contains('selected'));
    const channel = Math.min(pages.length - 1, Math.max(1, Number(selected?.dataset.channel ?? lastChannel) + step));
    const cell = listings.find(c => Number(c.dataset.channel) === channel);
    selectListing(cell);
    cell.focus();
  }

  function toggleGuide() {
    tune(current === GUIDE ? lastChannel : GUIDE);
  }

  // ---------- channels 09–10: quiz boards ----------

  // Each board is built from its category lists: a header per list, then one cell per value,
  // left blank where a category has fewer clues. Picking a cell zooms its clue card out to fill
  // the board; a click shows the answer, another returns to the board, where the cell now shows
  // what it was.
  let openClue = null; // { card, cell, revealed }

  function buildQuizBoard(board) {
    const lists = Array.from(board.querySelectorAll('.quiz-category'));
    const values = board.dataset.values.split(' ');
    board.style.setProperty('--cols', lists.length);
    board.style.setProperty('--rows', values.length);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'quiz-clue';
    card.hidden = true;
    card.innerHTML = '<span class="quiz-clue-text"></span>'
      + '<span class="quiz-response" hidden></span><span class="quiz-clue-tip"></span>';
    card.addEventListener('click', () => (openClue.revealed ? closeClue(true) : revealAnswer()));

    lists.forEach((list, c) => {
      const title = list.dataset.title;
      const head = document.createElement('div');
      head.className = 'quiz-cat';
      head.textContent = title;
      head.style.cssText = `--c: ${c + 1}; --r: 1`;
      board.append(head);
      const clues = Array.from(list.children);
      values.forEach((value, r) => {
        const clue = clues[r];
        const cell = document.createElement(clue ? 'button' : 'span');
        cell.className = 'quiz-cell' + (clue ? '' : ' empty');
        cell.style.cssText = `--c: ${c + 1}; --r: ${r + 2}`;
        if (clue) {
          cell.type = 'button';
          cell.textContent = '$' + value;
          cell.dataset.clue = clue.dataset.clue;
          cell.dataset.answer = clue.textContent.trim();
          cell.setAttribute('aria-label', `${title} for $${value}`);
          cell.addEventListener('click', () => showClue(card, cell));
        }
        board.append(cell);
      });
      list.remove();
    });
    board.append(card);
  }

  function showClue(card, cell) {
    card.querySelector('.quiz-clue-text').textContent = cell.dataset.clue;
    card.querySelector('.quiz-response').hidden = true;
    card.querySelector('.quiz-clue-tip').textContent = 'Click for the answer';
    card.hidden = false;
    openClue = { card, cell, revealed: false };
    card.focus();
    if (reduceMotion.matches) return;
    // Rects are in zoomed screen pixels; the transform works in the TV's own pixels.
    const zoom = parseFloat(root.style.getPropertyValue('--s')) || 1;
    const from = cell.getBoundingClientRect();
    const to = card.getBoundingClientRect();
    card.animate([
      { transform: `translate(${(from.left - to.left) / zoom}px, ${(from.top - to.top) / zoom}px) scale(${from.width / to.width}, ${from.height / to.height})` },
      { transform: 'none' }
    ], { duration: 320, easing: 'ease-out' });
  }

  function revealAnswer() {
    const { card, cell } = openClue;
    const response = card.querySelector('.quiz-response');
    response.textContent = `What is ${cell.dataset.answer}?`;
    response.hidden = false;
    card.querySelector('.quiz-clue-tip').textContent = 'Click to return to the board';
    openClue.revealed = true;
  }

  // Closing after the answer marks the cell as played; closing early (changing channel) doesn't.
  function closeClue(played) {
    if (!openClue) return;
    const { card, cell, revealed } = openClue;
    openClue = null;
    card.hidden = true;
    if (played && revealed) {
      cell.classList.add('played');
      cell.textContent = cell.dataset.answer;
      cell.setAttribute('aria-label', `${cell.getAttribute('aria-label')}: ${cell.dataset.answer}`);
      cell.focus();
    }
  }

  document.querySelectorAll('.quiz-board').forEach(buildQuizBoard);

  // ---------- channel 05: puzzle board ----------

  // Rows 1 and 4 have 12 tiles (columns 2–13), rows 2 and 3 have 14. Each puzzle line is
  // centred in its row. Clicking a hidden tile "calls" its letter: every tile with that letter
  // lights up, then turns one by one with a ding.
  const WOF_ROWS = [[2, 13], [1, 14], [1, 14], [2, 13]];
  // Phones get a board only as wide as the answer needs, so the tiles can be twice the size.
  const WOF_ROWS_NARROW = [[2, 7], [1, 8], [1, 8], [2, 7]];
  const WOF_TURN_MS = 420;

  function buildPuzzle(board) {
    const lines = board.dataset.lines.split('|');
    const tiles = [];
    const rows = phoneLayout.matches ? WOF_ROWS_NARROW : WOF_ROWS;
    board.style.setProperty('--cols', rows[1][1]);

    rows.forEach(([first, last], r) => {
      const line = (lines[r] || '').toUpperCase();
      const start = first + Math.floor((last - first + 1 - line.length) / 2);
      for (let c = first; c <= last; c++) {
        const ch = line[c - start];
        const isLetter = ch && ch !== ' ';
        const tile = document.createElement(isLetter ? 'button' : 'span');
        tile.className = 'wof-tile ' + (isLetter ? 'letter' : 'blank');
        tile.style.cssText = `--r: ${r + 1}; --c: ${c}`;
        if (isLetter) {
          tile.type = 'button';
          tile.dataset.letter = ch;
          tile.setAttribute('aria-label', 'Hidden letter');
          tile.addEventListener('click', () => callLetter(ch));
          tiles.push(tile);
        } else {
          tile.setAttribute('aria-hidden', 'true');
        }
        board.append(tile);
      }
    });

    const hidden = () => tiles.filter(t => !t.classList.contains('shown') && !t.classList.contains('lit'));

    function turn(tile) {
      tile.classList.remove('lit');
      tile.classList.add('shown');
      tile.textContent = tile.dataset.letter;
      tile.setAttribute('aria-label', tile.dataset.letter);
    }

    function callLetter(letter) {
      const matches = hidden().filter(t => t.dataset.letter === letter);
      matches.forEach(t => t.classList.add('lit'));
      matches.forEach((tile, i) => setTimeout(() => {
        turn(tile);
        ding();
      }, WOF_TURN_MS * (i + 1)));
    }
  }

  // A synthesized bell for each turned tile, following the TV's volume and mute.
  function ding() {
    if (audio.muted || !volume) return;
    const dingContext = soundContext();
    if (!dingContext) return;
    const now = dingContext.currentTime;
    const out = dingContext.createGain();
    out.connect(dingContext.destination);
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.3 * volume / 10, now + 0.005);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    [[1318.5, 1], [2637, 0.35], [3955, 0.12]].forEach(([frequency, level]) => {
      const tone = dingContext.createOscillator();
      const gain = dingContext.createGain();
      tone.frequency.value = frequency;
      gain.gain.value = level;
      tone.connect(gain).connect(out);
      tone.start(now);
      tone.stop(now + 0.95);
    });
  }

  function buildPuzzles() {
    document.querySelectorAll('.wof-tiles').forEach(board => {
      board.replaceChildren();
      buildPuzzle(board);
    });
  }

  buildPuzzles();
  phoneLayout.addEventListener('change', buildPuzzles);

  // ---------- "how to play" callouts (channels 05, 08, 09) ----------

  // Each goes away after the first move on its board, or when clicked.
  document.querySelectorAll('.play-hint').forEach(hint => {
    const board = hint.closest('.wof-frame, .quiz-board');
    const dismiss = () => hint.classList.add('done');
    hint.addEventListener('click', dismiss);
    board.addEventListener('click', event => {
      if (event.target.closest('.wof-tile.letter, .quiz-cell:not(.empty)')) dismiss();
    });
  });

  // ---------- news tickers (channels 03 and 05) ----------

  // A second copy of the list (hidden from screen readers) follows the first so the scroll
  // loops seamlessly; the duration comes from the list's width so the speed stays constant.
  const TICKER_PX_PER_S = 70;
  const newsTimes = Array.from(document.querySelectorAll('.news-time'));

  document.querySelectorAll('.news-ticker-track').forEach(track => {
    const list = track.querySelector('.news-ticker-text');
    const copy = list.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    copy.querySelectorAll('a').forEach(link => (link.tabIndex = -1));
    track.append(copy);
    const setSpeed = () => track.style.setProperty('--ticker-s', (list.offsetWidth / TICKER_PX_PER_S).toFixed(1) + 's');
    setSpeed();
    document.fonts?.ready.then(setSpeed); // Oswald changes the width once it loads
    window.addEventListener('resize', setSpeed); // and the phone layout uses smaller text
  });

  // ---------- on-screen display (channel, volume) ----------

  const OSD_MS = 3000;
  const POWER_ON_DELAY_MS = 600; // just after the power-on flash
  let osdTimer;

  function flashOsd(text, delay = 0) {
    clearTimeout(osdTimer);
    osd.classList.remove('show');
    osd.textContent = text;
    osdTimer = setTimeout(() => {
      osd.classList.add('show');
      osdTimer = setTimeout(() => osd.classList.remove('show'), OSD_MS);
    }, delay);
  }

  function flashChannel(delay = 0) {
    flashOsd('CH ' + pad(current), delay);
  }

  // ---------- now-playing marquee ----------

  // The band fades in, the track name scrolls across, then the band fades out.
  const MARQUEE_FADE_MS = 400;
  const MARQUEE_SCREEN_MS = 4200; // time for the name to travel one screen width
  const MARQUEE_STILL_MS = 4000; // how long the name shows for reduced motion
  let marqueeTimer;
  let marqueeFade;
  let marqueeScroll;

  function stopMarquee() {
    clearTimeout(marqueeTimer);
    marqueeFade?.cancel();
    marqueeScroll?.cancel();
  }

  function showTrackName(name) {
    stopMarquee();
    marqueeText.textContent = '♪ Now playing: ' + name;
    const still = reduceMotion.matches;
    marquee.classList.toggle('still', still);
    // Both rects are zoomed equally, so the ratio (and so the speed) is zoom-independent.
    const scrollMs = still ? MARQUEE_STILL_MS
      : MARQUEE_SCREEN_MS * marqueeText.getBoundingClientRect().width / marquee.getBoundingClientRect().width;
    const total = scrollMs + MARQUEE_FADE_MS * 2;
    marqueeFade = marquee.animate([
      { opacity: 0 },
      { opacity: 1, offset: MARQUEE_FADE_MS / total },
      { opacity: 1, offset: 1 - MARQUEE_FADE_MS / total },
      { opacity: 0 }
    ], { duration: total });
    if (!still) {
      marqueeScroll = marqueeText.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }],
        { duration: scrollMs, delay: MARQUEE_FADE_MS }
      );
    }
  }

  // ---------- sound ----------

  // Background music. Powering on or changing channel switches to a different
  // track at a random point; when a track ends, another starts from the top.
  // Power on and channel changes play a sound effect first, then fade the track in;
  // power off cuts the music and plays its own effect.
  // GitHub Pages can't list a folder, so files added to tracks/ go in here too.
  const TRACKS = ['Caligula', 'Falling Into Place', 'Head First', 'In between years', 'This Will Pass', 'Visions II'];
  const TAIL_S = 30; // never start closer than this to the end of a track
  const FADE_IN_MS = 1500;
  const audio = new Audio();
  const effects = {
    static: new Audio('soundeffects/staticchange.mp3'),
    on: new Audio('soundeffects/tvon.mp3'),
    off: new Audio('soundeffects/tvoff.mp3')
  };
  // A spark for every click on the picture. The .wav is the .mp3 levelled up: the recording is
  // quiet, and an audio element can only make it quieter — its volume stops at 1.
  const SPARK_GAIN = 0.52; // it is a sharp sound, so it sits below the music
  const spark = new Audio('soundeffects/spark.wav');
  const allEffects = [...Object.values(effects), spark];
  let track = -1;
  let volume = 4; // 0–10
  let fadeLevel = 1; // 0–1, multiplies the music volume during a fade-in
  let fadeTimer;
  let audibleAt = 0; // when the current fade-in starts, so the marquee can wait for it
  let loadToken = 0;
  let context; // the WebAudio context, shared by the puzzle's bell and the pointer sounds
  allEffects.forEach(sound => (sound.preload = 'auto'));
  applyVolume();

  // Browsers only let the context start once the visitor has interacted, which by the time any
  // of this makes a sound they have: the TV has to be on.

  function soundContext() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    try {
      context ||= new Context();
    } catch {
      return null;
    }
    if (context.state === 'suspended') context.resume();
    return context;
  }

  function applyVolume() {
    audio.volume = (volume / 10) * fadeLevel * fadeLevel; // squared, so the fade eases in
    Object.values(effects).forEach(sound => (sound.volume = volume / 10));
    spark.volume = Math.min(1, (volume / 10) * SPARK_GAIN);
  }

  function setMuted(muted) {
    audio.muted = muted;
    allEffects.forEach(sound => (sound.muted = muted));
  }

  // Browsers only start sound from a gesture they count as one, and a swipe is not among them:
  // a swipe that turns the set on has its sound refused. When that happens, the next tap or key
  // press starts the music instead — by then the effect that went with it is long past.
  let waitingForGesture = false;

  function startMusicOnGesture() {
    if (waitingForGesture) return;
    waitingForGesture = true;
    const go = () => {
      waitingForGesture = false;
      document.removeEventListener('pointerup', go);
      document.removeEventListener('keydown', go);
      if (power.checked) audio.play().catch(() => {});
    };
    document.addEventListener('pointerup', go);
    document.addEventListener('keydown', go);
  }

  function refused(error) {
    return error && error.name === 'NotAllowedError';
  }

  // One effect at a time: a new one cuts off whatever effect is still playing.
  function playEffect(sound) {
    allEffects.forEach(s => s.pause());
    sound.currentTime = 0;
    sound.play().catch(error => {
      if (refused(error)) startMusicOnGesture();
    });
  }

  function stopFade() {
    clearTimeout(fadeTimer);
    clearInterval(fadeTimer);
    fadeLevel = 1;
    audibleAt = 0;
    applyVolume();
  }

  // Silence the music now, then fade it in once the effect has finished.
  // (An interval rather than requestAnimationFrame, so it still finishes in a background tab.)
  function fadeInAfter(sound, fallbackSeconds) {
    stopFade();
    fadeLevel = 0;
    applyVolume();
    const delay = (sound.duration || fallbackSeconds) * 1000;
    audibleAt = performance.now() + delay;
    fadeTimer = setTimeout(() => {
      const start = performance.now();
      fadeTimer = setInterval(() => {
        fadeLevel = Math.min(1, (performance.now() - start) / FADE_IN_MS);
        applyVolume();
        if (fadeLevel === 1) clearInterval(fadeTimer);
      }, 30);
    }, delay);
  }

  function playRandomTrack(randomPoint) {
    const others = TRACKS.map((_, i) => i).filter(i => i !== track);
    track = others[Math.floor(Math.random() * others.length)];
    const token = ++loadToken;
    audio.src = 'tracks/' + encodeURIComponent(TRACKS[track]) + '.mp3';
    if (randomPoint) {
      audio.addEventListener('loadedmetadata', () => {
        if (token === loadToken) audio.currentTime = Math.random() * Math.max(0, audio.duration - TAIL_S);
      }, { once: true });
    }
    audio.addEventListener('playing', () => {
      if (token !== loadToken) return;
      clearTimeout(marqueeTimer);
      marqueeTimer = setTimeout(() => {
        if (token === loadToken) showTrackName(TRACKS[track]);
      }, Math.max(0, audibleAt - performance.now()));
    }, { once: true });
    audio.play().catch(error => {
      if (refused(error)) startMusicOnGesture();
    });
  }

  audio.addEventListener('ended', () => playRandomTrack(false));

  function changeVolume(step) {
    if (!power.checked) return;
    volume = Math.min(10, Math.max(0, volume + step));
    setMuted(false);
    applyVolume();
    flashOsd('VOL ' + pad(volume));
  }

  function toggleMute() {
    if (!power.checked) return;
    setMuted(!audio.muted);
    flashOsd(audio.muted ? 'MUTE' : 'VOL ' + pad(volume));
  }

  document.getElementById('volume-up').addEventListener('click', () => changeVolume(1));
  document.getElementById('volume-down').addEventListener('click', () => changeVolume(-1));
  document.getElementById('mute').addEventListener('click', toggleMute);

  // ---------- pointer sounds ----------

  // A spark for every click on the lit picture, whether or not it lands on something.
  screen.addEventListener('pointerdown', () => {
    if (!power.checked) return;
    spark.currentTime = 0;
    spark.play().catch(() => {}); // blocked until the visitor interacts; powering on counts
  });

  // ---------- channel-change animation ----------

  // A burst of static, then the whole picture (page, logo and clock) and the
  // now-playing marquee roll down slightly and settle. The roll overrides the power
  // animation's transform on .contents only while it runs, then hands back to it.
  const STATIC_MS = 380; // opaque for the first 60%, then fades
  const ROLL_MS = 520; // starts rolling as the static fades
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const snowContext = snow.getContext('2d');
  const snowImage = snowContext.createImageData(snow.width, snow.height);
  const snowPixels = new Uint32Array(snowImage.data.buffer);
  let snowFrame;
  let burst;
  let rolls = [];

  function drawSnow() {
    for (let i = 0; i < snowPixels.length; i++) {
      const v = (Math.random() * 256) | 0;
      snowPixels[i] = 0xff000000 | (v << 16) | (v << 8) | v; // opaque grey (ABGR)
    }
    snowContext.putImageData(snowImage, 0, 0);
    snowFrame = requestAnimationFrame(drawSnow);
  }

  function playTuning() {
    if (reduceMotion.matches) return;
    burst?.cancel();
    rolls.forEach(r => r.cancel());
    cancelAnimationFrame(snowFrame);
    drawSnow();
    burst = snow.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: STATIC_MS });
    burst.onfinish = () => cancelAnimationFrame(snowFrame);
    const fadeStart = (STATIC_MS * 0.6) / ROLL_MS;
    const keyframes = [
      { transform: 'translateY(-14px)' },
      { transform: 'translateY(-14px)', offset: fadeStart, easing: 'ease-out' },
      { transform: 'translateY(5px)', offset: STATIC_MS / ROLL_MS, easing: 'ease-in-out' },
      { transform: 'none' }
    ];
    rolls = [picture, marquee].map(el => el.animate(keyframes, { duration: ROLL_MS }));
  }

  // ---------- power ----------

  // `was-on` lets the power-off animation play from then on, and retires the hint.
  // Nothing on a dark screen can be clicked or tabbed to. Before the first power-on the picture
  // is only transparent, so without this its links would still take a click.
  function setPictureLive() {
    picture.inert = !power.checked;
  }

  function turnedOn() {
    tv.classList.add('was-on');
    setPictureLive();
    hideInfo();
    flashChannel(POWER_ON_DELAY_MS);
    playEffect(effects.on);
    fadeInAfter(effects.on, 2.3);
    playRandomTrack(true);
  }

  function turnedOff() {
    setPictureLive();
    hideInfo();
    clearTimeout(osdTimer);
    osd.classList.remove('show');
    stopMarquee();
    stopFade();
    audio.pause();
    playEffect(effects.off);
  }

  power.addEventListener('change', () => (power.checked ? turnedOn() : turnedOff()));

  // Like a real TV, changing channel while it's off turns it on (with the
  // power-on animation instead of the tuning one).
  function tune(index) {
    const previous = current;
    show(index);
    if (current !== previous) previousChannel = previous;
    if (!power.checked) {
      power.checked = true;
      turnedOn();
      return;
    }
    if (current !== previous) {
      playTuning();
      playEffect(effects.static);
      fadeInAfter(effects.static, 0.3);
      playRandomTrack(true);
    }
    flashChannel();
  }

  // ---------- number keys ----------

  // Like a real remote: a digit that can't start a two-digit channel tunes at once; one that
  // can (with channels 00–09, only 0) waits briefly for a second digit, so 0 alone is the guide.
  const DIGIT_WAIT_MS = 1200;
  let firstDigit = null;
  let digitTimer;

  function enterDigit(digit) {
    clearTimeout(digitTimer);
    if (firstDigit !== null) {
      const channel = firstDigit * 10 + digit;
      firstDigit = null;
      if (channel < pages.length) tune(channel);
      else enterDigit(digit); // no such channel: start again from this digit
      return;
    }
    if (digit * 10 >= pages.length) {
      if (digit < pages.length) tune(digit);
      else if (power.checked) flashChannel(); // no such channel: stay put and show where we are
      return;
    }
    firstDigit = digit;
    if (power.checked) flashOsd('CH ' + digit + '-');
    digitTimer = setTimeout(() => {
      firstDigit = null;
      tune(digit);
    }, DIGIT_WAIT_MS);
  }

  // ---------- BACK and INFO ----------

  // BACK is a "last channel" key: it flips between this channel and the one before.
  // With no history yet it just shows the channel number (and turns the TV on if it's off).
  function goBack() {
    tune(previousChannel ?? current);
  }

  // INFO reopens the first-visit hint; any other remote key, a click on it, or Esc closes it.
  const hint = document.querySelector('.hint');

  function showInfo() {
    tv.classList.add('hint-open');
    if (phoneLayout.matches) hint.scrollIntoView({ behavior: 'smooth', block: 'center' }); // the remote is far below it
  }

  function hideInfo() {
    tv.classList.remove('hint-open');
  }

  hint.addEventListener('click', hideInfo);

  // ---------- the remote's transmitter light ----------

  // Flickers red while any remote key is held, and blinks for keys pressed from the keyboard.
  const remote = document.querySelector('.remote');
  const remoteLed = document.querySelector('.remote-led');
  const LED_MIN_MS = 150;
  let ledOnAt = 0;
  let ledTimer;

  function ledOn() {
    clearTimeout(ledTimer);
    ledOnAt = performance.now();
    remoteLed.classList.add('sending');
  }

  function ledOff() {
    clearTimeout(ledTimer);
    ledTimer = setTimeout(() => remoteLed.classList.remove('sending'), Math.max(0, LED_MIN_MS - (performance.now() - ledOnAt)));
  }

  remote.addEventListener('pointerdown', event => {
    if (event.target.closest('.key')) ledOn();
  });
  document.addEventListener('pointerup', ledOff);
  document.addEventListener('pointercancel', ledOff);
  remote.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('.key')) {
      ledOn();
      ledOff();
    }
  });

  // ---------- remote, keyboard and swipes ----------

  document.getElementById('channel-up').addEventListener('click', () => tune(current + 1));
  document.getElementById('channel-down').addEventListener('click', () => tune(current - 1));
  document.getElementById('guide-key').addEventListener('click', toggleGuide);
  document.getElementById('back-key').addEventListener('click', goBack);
  document.getElementById('info-key').addEventListener('click', () => {
    if (tv.classList.contains('hint-open')) hideInfo();
    else showInfo();
  });
  document.querySelectorAll('[data-digit]').forEach(key => {
    key.addEventListener('click', () => enterDigit(Number(key.dataset.digit)));
  });

  // The keys on the set itself do exactly what their opposite number on the remote does.
  document.querySelectorAll('[data-set-key]').forEach(key => {
    key.addEventListener('click', () => document.getElementById(key.dataset.setKey).click());
  });

  // Any remote key other than INFO closes the reopened hint.
  remote.addEventListener('click', event => {
    const key = event.target.closest('.key');
    if (key && key.id !== 'info-key') hideInfo();
  });

  window.addEventListener('hashchange', () => tune(hashIndex()));

  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') {
      hideInfo();
      closeClue(false);
    }
    else if (event.key === 'ArrowRight') tune(current + 1);
    else if (event.key === 'ArrowLeft') tune(current - 1);
    else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && current === GUIDE && power.checked) {
      moveListing(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === '+' || event.key === '=') changeVolume(1);
    else if (event.key === '-' || event.key === '_') changeVolume(-1);
    else if (event.key === 'm' || event.key === 'M') toggleMute();
    else if (event.key === 'g' || event.key === 'G') toggleGuide();
    else if (/^[0-9]$/.test(event.key)) enterDigit(Number(event.key));
    else return;
    event.preventDefault();
  });

  let touchX = null;
  let touchY = null;
  screen.addEventListener('touchstart', event => {
    touchX = event.touches[0].clientX;
    touchY = event.touches[0].clientY;
  }, { passive: true });
  screen.addEventListener('touchend', event => {
    if (touchX === null) return;
    const dx = event.changedTouches[0].clientX - touchX;
    const dy = event.changedTouches[0].clientY - touchY;
    touchX = null;
    // Up for the next channel, down for the previous one.
    if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.5) tune(current + (dy < 0 ? 1 : -1));
  });

  // ---------- clock ----------

  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function tick() {
    const now = new Date();
    const hours = now.getHours();
    clockTime.textContent = `${pad(hours % 12 || 12, ' ')}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${hours < 12 ? 'AM' : 'PM'}`;
    clockDate.textContent = `${DAYS[now.getDay()]} ${MONTHS[now.getMonth()]} ${pad(now.getDate(), ' ')}`;
    newsTimes.forEach(el => (el.textContent = `${hours % 12 || 12}:${pad(now.getMinutes())}`));
    // guide: "2:52pm", and three half-hour slots starting at the current one
    epgTime.textContent = `${hours % 12 || 12}:${pad(now.getMinutes())}${hours < 12 ? 'am' : 'pm'}`;
    const slot = new Date(now);
    slot.setMinutes(now.getMinutes() < 30 ? 0 : 30, 0, 0);
    epgSlots.forEach((el, i) => {
      const t = new Date(slot.getTime() + i * 30 * 60000);
      const h = t.getHours();
      el.textContent = `${h % 12 || 12}:${pad(t.getMinutes())}${h < 12 ? 'am' : 'pm'}${i === epgSlots.length - 1 ? ' ▸' : ''}`;
    });
    setTimeout(tick, 1000 - now.getMilliseconds());
  }

  // ---------- curved glass ----------

  // Barrel distortion for the picture through #crt's feDisplacementMap: each point shows
  // the content from a little nearer the centre, most between the centre and the edges,
  // so the picture bulges like it's on the curved face of a tube. The mid-edges don't
  // move, and the corners pull slightly out of view (where the tube's outline cuts anyway).
  const CURVE = 0.04; // strength of the bulge
  const CURVE_SCALE = 60; // feDisplacementMap's scale in index.html: shifts up to ±30px
  const curveMap = document.getElementById('crt-map');
  let curveSize = '';

  // Shifts are in the picture's own (unzoomed) pixels, which is what Chrome's filter units are.
  function drawCurveMap() {
    const width = picture.offsetWidth;
    const height = picture.offsetHeight;
    if (!width || !height || curveSize === width + 'x' + height) return;
    curveSize = width + 'x' + height;
    // A quarter-size map is plenty: the shifts vary smoothly and the filter stretches it.
    const w = Math.ceil(width / 4);
    const h = Math.ceil(height / 4);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    const image = context.createImageData(w, h);
    for (let j = 0; j < h; j++) {
      const ny = ((j + 0.5) / h) * 2 - 1;
      for (let i = 0; i < w; i++) {
        const nx = ((i + 0.5) / w) * 2 - 1;
        const pull = (1 + CURVE * (nx * nx + ny * ny)) / (1 + CURVE) - 1; // < 0 inside the mid-edges
        const k = (j * w + i) * 4;
        image.data[k] = 128 + ((nx * pull * width) / 2 / CURVE_SCALE) * 255;
        image.data[k + 1] = 128 + ((ny * pull * height) / 2 / CURVE_SCALE) * 255;
        image.data[k + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    curveMap.setAttribute('href', canvas.toDataURL());
  }

  // The picture is taller on phones, so redraw the map whenever its size changes.
  new ResizeObserver(drawCurveMap).observe(picture);

  // ---------- scale the TV to the window ----------

  const tvSet = document.querySelector('.tv-set');
  const REMOTE_ROOM = 16; // px of breathing room wanted under the remote
  let remoteSpan = 0; // how far the remote reaches below the set, at scale 1

  // On phones the remote stacks under the TV, where a short window leaves it off the bottom of
  // the page. There it is dropped, and the set's own keys and swipes cover what it did.
  function fitRemote(scale) {
    if (!phoneLayout.matches) {
      tv.classList.remove('no-remote');
      return;
    }
    const setBottom = tvSet.getBoundingClientRect().bottom + window.scrollY;
    if (!tv.classList.contains('no-remote')) {
      const span = remote.getBoundingClientRect().bottom + window.scrollY - setBottom;
      if (span > 0) remoteSpan = span / scale;
    }
    tv.classList.toggle('no-remote', setBottom + remoteSpan * scale + REMOTE_ROOM > window.innerHeight);
  }

  // The phone picture has no set height: it is given whatever the window has room for, once the
  // bezel and the front panel have taken their share. Both limits are design pixels.
  const PHONE_SCREEN_MIN = 600;
  const PHONE_SCREEN_MAX = 1400;

  // On phones the hint points down at the set's power key, wherever the panel puts it.
  function aimHint(scale) {
    const key = document.querySelector('.tv-power').getBoundingClientRect();
    const box = hint.getBoundingClientRect();
    if (!key.width || !box.width) return;
    hint.style.setProperty('--hint-arrow-x', Math.round((key.left + key.width / 2 - box.left) / scale) + 'px');
  }

  function fitPhoneScreen(scale) {
    const extras = (tvSet.getBoundingClientRect().height - picture.getBoundingClientRect().height) / scale;
    const room = (window.innerHeight - 40) / scale; // 40: the body's top and bottom padding
    const height = Math.min(PHONE_SCREEN_MAX, Math.max(PHONE_SCREEN_MIN, Math.round(room - extras)));
    root.style.setProperty('--phone-screen-h', height + 'px');
  }

  function fit() {
    const style = getComputedStyle(root);
    const width = parseFloat(style.getPropertyValue('--tv-w'));
    const height = parseFloat(style.getPropertyValue('--tv-fit-h'));
    let scale = Math.max(0.25, Math.min(1.25, (root.clientWidth - 32) / width));
    if (height) scale = Math.max(0.25, Math.min(scale, (window.innerHeight - 76) / height)); // 76: the body's padding
    if (!phoneLayout.matches) {
      root.style.removeProperty('--phone-screen-h');
      root.style.setProperty('--s', scale.toFixed(4));
      fitRemote(scale);
      return;
    }
    // Sizing the picture changes how tall the set is, so the two settle together: a second pass
    // is enough, the first having taken the scale down to where the set does fit (landscape).
    for (let pass = 0; pass < 2; pass++) {
      root.style.setProperty('--s', scale.toFixed(4));
      fitPhoneScreen(scale);
      const design = tvSet.getBoundingClientRect().height / scale;
      const fitted = Math.max(0.25, Math.min(scale, (window.innerHeight - 40) / design));
      if (fitted >= scale - 0.001) break;
      scale = fitted;
    }
    fitRemote(scale);
    aimHint(scale);
  }

  window.addEventListener('resize', fit);
  fit();
  tick();
  show(hashIndex());
  // Browsers hand a checkbox its old state back on a reload or a back navigation, which would
  // bring the set on with nothing having switched it on: the power-on flash replays, there is no
  // sound, and the welcome is hidden. Every arrival starts the same way instead.
  power.checked = false;
  setPictureLive();
})();
