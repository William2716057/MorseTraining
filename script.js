(function () {
    'use strict';

    const MODES = {
        words: { dict: window.MORSE_WORDS, base: 10 },
        sentences: { dict: window.MORSE_SENTENCES, base: 25 }
    };

    const $ = id => document.getElementById(id);
    const el = {
        score: $('score'), streak: $('streak'), best: $('best'), round: $('round'),
        lamp: $('lamp'), status: $('status'), reveal: $('reveal'),
        guess: $('guess'), submit: $('submit'),
        start: $('start'), replay: $('replay'), skip: $('skip'),
        modeWords: $('mode-words'), modeSentences: $('mode-sentences'),
        wpm: $('wpm'), freq: $('freq'), vol: $('vol'), space: $('space')
    };

    const state = {
        mode: 'words', deck: [], current: null,
        score: 0, streak: 0, best: 0, solved: 0,
        replays: 0, misses: 0, answered: false, started: false
    };

    //storage (best score is just a convenience)
    try { state.best = parseInt(localStorage.getItem('morse-best') || '0', 10) || 0; } catch (e) { }
    function saveBest() { try { localStorage.setItem('morse-best', String(state.best)); } catch (e) { } }

    //audio 
    let ctx = null, master = null, tones = [], endTimer = null;

    function ensureAudio() {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            ctx = new AC();
        }
        if (ctx.state === 'suspended') ctx.resume();
    }

    function stopAudio() {
        clearTimeout(endTimer);
        tones.forEach(o => { try { o.stop(); } catch (e) { } });
        tones = [];
        if (master) { try { master.disconnect(); } catch (e) { } master = null; }
        el.lamp.classList.remove('on');
    }

    function playMorse(morse) {
        ensureAudio();
        stopAudio();

        master = ctx.createGain();
        master.gain.value = Math.pow(el.vol.value / 100, 2);
        master.connect(ctx.destination);

        const unit = 1.2 / el.wpm.value;           // seconds per dot (PARIS timing)
        const stretch = parseFloat(el.space.value); // Farnsworth-style gap stretching
        const letterGap = 3 * unit * stretch;
        const wordGap = 7 * unit * stretch;
        const freq = +el.freq.value;

        let t = ctx.currentTime + 0.25;
        const startAt = t;

        morse.split(' / ').forEach((word, wi) => {
            if (wi > 0) t += wordGap;
            word.split(' ').forEach((letter, li) => {
                if (li > 0) t += letterGap;
                [...letter].forEach((sym, si) => {
                    if (si > 0) t += unit;
                    const dur = sym === '.' ? unit : 3 * unit;
                    scheduleTone(t, dur, freq);
                    t += dur;
                });
            });
        });

        el.lamp.classList.add('on');
        endTimer = setTimeout(() => {
            el.lamp.classList.remove('on');
            if (!state.answered) setStatus('Transmission finished. Type what you heard.');
        }, (t - ctx.currentTime + 0.1) * 1000);
        return t - startAt;
    }

    function scheduleTone(start, dur, freq) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        const ramp = 0.006; // short fade avoids key clicks
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(1, start + ramp);
        g.gain.setValueAtTime(1, start + dur - ramp);
        g.gain.linearRampToValueAtTime(0, start + dur);
        osc.connect(g).connect(master);
        osc.start(start);
        osc.stop(start + dur + 0.02);
        tones.push(osc);
    }

    //game logic
    function normalize(s) {
        return s.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    }

    function shuffle(a) {
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function nextItem() {
        const dict = MODES[state.mode].dict;
        if (!state.deck.length) state.deck = shuffle(Object.keys(dict));
        const morse = state.deck.pop();
        state.current = { morse: morse, answer: dict[morse] };
    }

    function setStatus(msg, cls) {
        el.status.textContent = msg;
        el.status.className = 'status' + (cls ? ' ' + cls : '');
    }

    function updateStats() {
        el.score.textContent = state.score;
        el.streak.textContent = state.streak;
        el.best.textContent = state.best;
        el.round.textContent = state.solved;
    }

    function setPlaying(on) {
        el.guess.disabled = !on;
        el.submit.disabled = !on;
        el.replay.disabled = !on;
        el.skip.disabled = !on;
    }

    function newRound() {
        nextItem();
        state.replays = 0;
        state.misses = 0;
        state.answered = false;
        el.reveal.textContent = '';
        el.reveal.className = 'answer-reveal';
        el.guess.value = '';
        el.submit.textContent = 'Check';
        setPlaying(true);
        setStatus('Listening…');
        el.guess.focus();
        playMorse(state.current.morse);
    }

    function replay() {
        if (!state.current || state.answered) return;
        state.replays++;
        setStatus('Listening again…');
        playMorse(state.current.morse);
        el.guess.focus();
    }

    function check() {
        if (state.answered) { newRound(); return; }
        const guess = normalize(el.guess.value);
        if (!guess) return;

        if (guess === normalize(state.current.answer)) {
            const pts = Math.max(1, MODES[state.mode].base - 2 * state.replays - 3 * state.misses);
            state.score += pts;
            state.streak++;
            state.solved++;
            if (state.score > state.best) { state.best = state.score; saveBest(); }
            state.answered = true;
            stopAudio();
            el.reveal.textContent = state.current.answer;
            setStatus('Correct! +' + pts + ' points', 'good');
            el.guess.disabled = true;
            el.skip.disabled = true;
            el.replay.disabled = true;
            el.submit.textContent = 'Next';
            el.submit.focus();
        } else {
            state.misses++;
            state.streak = 0;
            setStatus('Not quite. Replay and try again.', 'bad');
            el.guess.classList.remove('shake');
            void el.guess.offsetWidth;
            el.guess.classList.add('shake');
            el.guess.select();
        }
        updateStats();
    }

    function skip() {
        if (state.answered) return;
        state.answered = true;
        state.streak = 0;
        stopAudio();
        el.reveal.textContent = state.current.answer;
        el.reveal.classList.add('skipped');
        setStatus('Skipped. That one said:');
        el.guess.disabled = true;
        el.skip.disabled = true;
        el.replay.disabled = true;
        el.submit.textContent = 'Next';
        el.submit.disabled = false;
        el.submit.focus();
        updateStats();
    }

    function setMode(mode) {
        if (state.mode === mode) return;
        state.mode = mode;
        state.deck = [];
        el.modeWords.setAttribute('aria-pressed', mode === 'words');
        el.modeSentences.setAttribute('aria-pressed', mode === 'sentences');
        if (state.started) newRound();
    }

    // wiring
    el.start.addEventListener('click', () => {
        state.started = true;
        el.start.textContent = 'Restart';
        state.score = 0; state.streak = 0; state.solved = 0;
        updateStats();
        newRound();
    });
    el.replay.addEventListener('click', replay);
    el.skip.addEventListener('click', skip);
    el.submit.addEventListener('click', check);
    el.modeWords.addEventListener('click', () => setMode('words'));
    el.modeSentences.addEventListener('click', () => setMode('sentences'));

    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.code === 'Space') { e.preventDefault(); replay(); return; }
        if (e.key === 'Enter' && state.started &&
            (document.activeElement === el.guess || state.answered)) {
            e.preventDefault();
            check();
        }
    });

    [['wpm', ' wpm'], ['freq', ' Hz'], ['vol', '%']].forEach(([id, unit]) => {
        const input = $(id), out = $(id + '-out');
        input.addEventListener('input', () => { out.textContent = input.value + unit; });
    });

    updateStats();
})();