/**
 * assets/js/scroll-stage.js
 * Chatlytics.de — Swiss Technical Monolith & Scroll-Craft Stage Engine
 *
 * Powers:
 * 1. 3-Plane Dimensional Hero (background coordinate grid, subject telemetry frame, foreground calipers)
 * 2. Signature Move & Engineered Peak: Scroll-Scrubbed 3-Model Race (OpenAI vs. Claude vs. Gemini)
 * 3. Persistent Swiss Coordinate Trace Rail & playhead readout
 * 4. Mobile Navigation Drawer & 3-Track Mobile Race Switcher
 * 5. Full prefers-reduced-motion: reduce & keyboard scrubber compliance
 */

const RACE_SCENARIOS = {
  de: {
    openai: {
      provider: 'OpenAI GPT-4o',
      text: 'Für den deutschen Mittelstand ist Personio die führende HR-Software mit durchgängiger Lohnabrechnung. Als internationale Option folgt Workday.',
      brand: 'Personio',
      brandIdx: 34,
      comp: 'Workday',
      compIdx: 134,
      mece: '1_DIRECT_WIN',
      geo: 'NONE',
      citations: ['personio.de/hr-mittelstand']
    },
    claude: {
      provider: 'Anthropic Claude 3.5',
      text: 'Im Enterprise- und Mittelstandssegment gilt Workday als globaler Referenzstandard. Ergänzend wird im DACH-Raum häufig Personio implementiert.',
      brand: 'Personio',
      brandIdx: 118,
      comp: 'Workday',
      compIdx: 44,
      mece: '2_BRAND_HALO',
      geo: '3_BRAND_HALO_TRAP',
      citations: ['gartner.com/hr-suite', 'personio.de']
    },
    gemini: {
      provider: 'Google Gemini + Grounding',
      text: 'Moderne HR-Systeme automatisieren Recruiting und Zeiterfassung. Marktführer für wachsende Unternehmen sind vor allem Workday und SAP SuccessFactors.',
      brand: 'Personio',
      brandIdx: -1,
      comp: 'Workday',
      compIdx: 117,
      mece: '3_COMPETITOR_TAKEOVER',
      geo: '2_PARAMETRIC_BLINDSPOT',
      citations: ['personio.de/leitfaden-hr', 'sap.com']
    }
  },
  en: {
    openai: {
      provider: 'OpenAI GPT-4o',
      text: 'For the European mid-market, Personio is the leading all-in-one HR platform with native payroll compliance. Workday serves as a secondary enterprise option.',
      brand: 'Personio',
      brandIdx: 29,
      comp: 'Workday',
      compIdx: 108,
      mece: '1_DIRECT_WIN',
      geo: 'NONE',
      citations: ['personio.de/hr-midmarket']
    },
    claude: {
      provider: 'Anthropic Claude 3.5',
      text: 'Across mid-market and enterprise deployments, Workday remains the primary benchmark. For DACH-specific teams, Personio is also frequently evaluated.',
      brand: 'Personio',
      brandIdx: 110,
      comp: 'Workday',
      compIdx: 46,
      mece: '2_BRAND_HALO',
      geo: '3_BRAND_HALO_TRAP',
      citations: ['gartner.com/hr-suite', 'personio.de']
    },
    gemini: {
      provider: 'Google Gemini + Grounding',
      text: 'Cloud HR suites streamline onboarding and time tracking. Top recommendations for scaling European organizations are Workday and SAP SuccessFactors.',
      brand: 'Personio',
      brandIdx: -1,
      comp: 'Workday',
      compIdx: 116,
      mece: '3_COMPETITOR_TAKEOVER',
      geo: '2_PARAMETRIC_BLINDSPOT',
      citations: ['personio.de/hr-guide', 'sap.com']
    }
  }
};

function escapeText(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getLang() {
  const i18nObj = window.ChatlyticsI18n || window.i18n;
  if (i18nObj && typeof i18nObj.getLanguage === 'function') {
    return i18nObj.getLanguage() === 'en' ? 'en' : 'de';
  }
  return document.documentElement.lang === 'en' ? 'en' : 'de';
}

export class ScrollCraftStage {
  constructor() {
    this.reducedMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    this.progress = this.reducedMotion ? 1 : 0.38;
    this.manualOverride = false;
    this.activeMobileModel = 'openai';
    this.heroVisible = true;
    this.rafPending = false;
  }

  init() {
    this.initMobileNavigation();
    this.initHeroPlanes();
    this.initModelRace();
    this.initTraceRail();

    // Re-render race streams on language toggle
    window.addEventListener('languageChanged', () => {
      this.renderRaceProgress(this.progress);
    });
  }

  initMobileNavigation() {
    const toggleBtn = document.getElementById('btn-mobile-menu');
    const drawer = document.getElementById('mobile-nav-drawer');
    if (!toggleBtn || !drawer) return;

    toggleBtn.addEventListener('click', () => {
      const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      const nextState = !isExpanded;
      toggleBtn.setAttribute('aria-expanded', String(nextState));
      drawer.classList.toggle('drawer-open', nextState);
      drawer.setAttribute('aria-hidden', String(!nextState));
    });

    // Close drawer when any navigation anchor inside is clicked
    drawer.querySelectorAll('a, button').forEach((el) => {
      el.addEventListener('click', () => {
        toggleBtn.setAttribute('aria-expanded', 'false');
        drawer.classList.remove('drawer-open');
        drawer.setAttribute('aria-hidden', 'true');
      });
    });
  }

  initHeroPlanes() {
    const heroSection = document.querySelector('.hero-section');
    const stageEl = document.getElementById('hero-dimensional-stage');
    if (!heroSection || !stageEl) return;

    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            this.heroVisible = entry.isIntersecting;
          });
        },
        { threshold: 0.05 }
      );
      obs.observe(heroSection);
    }

    // Subtle pointer depth on desktop when reduced motion is off
    stageEl.addEventListener('pointermove', (e) => {
      if (this.reducedMotion || !this.heroVisible) return;
      const rect = stageEl.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
      stageEl.style.setProperty('--hero-px', nx.toFixed(3));
      stageEl.style.setProperty('--hero-py', ny.toFixed(3));
    });

    stageEl.addEventListener('pointerleave', () => {
      stageEl.style.setProperty('--hero-px', '0');
      stageEl.style.setProperty('--hero-py', '0');
    });
  }

  initModelRace() {
    const raceSection = document.getElementById('race');
    const scrubber = document.getElementById('race-scrubber');
    const mobileTabs = document.querySelectorAll('[data-race-tab]');

    if (!raceSection) return;

    // Bind manual scrubber range input
    if (scrubber) {
      scrubber.addEventListener('input', (e) => {
        this.manualOverride = true;
        const val = Math.max(0, Math.min(100, Number(e.target.value || 0))) / 100;
        this.progress = val;
        this.renderRaceProgress(this.progress);
      });
    }

    // Bind mobile 3-track switcher tabs
    mobileTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const model = tab.getAttribute('data-race-tab');
        if (!model) return;
        this.activeMobileModel = model;
        mobileTabs.forEach((t) => {
          const active = t.getAttribute('data-race-tab') === model;
          t.classList.toggle('active', active);
          t.setAttribute('aria-selected', String(active));
        });
        document.querySelectorAll('[data-race-card]').forEach((card) => {
          const isMatch = card.getAttribute('data-race-card') === model;
          card.classList.toggle('mobile-card-active', isMatch);
        });
      });
    });

    // Initial render (starts with meaningful partial or full stream so it's never blank)
    const initialProgress = this.reducedMotion ? 1.0 : 0.85;
    this.progress = initialProgress;
    this.renderRaceProgress(initialProgress);

    // Scroll listener driving --sc-p through the race section
    window.addEventListener(
      'scroll',
      () => {
        if (this.rafPending) return;
        this.rafPending = true;
        window.requestAnimationFrame(() => {
          this.rafPending = false;
          this.onScrollTick();
        });
      },
      { passive: true }
    );
  }

  onScrollTick() {
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const docHeight = Math.max(
      1,
      document.documentElement.scrollHeight - window.innerHeight
    );
    const globalP = Math.max(0, Math.min(1, scrollY / docHeight));
    document.documentElement.style.setProperty('--sc-global-p', globalP.toFixed(4));

    // Update Hero scroll depth planes
    if (!this.reducedMotion && this.heroVisible) {
      const heroShift = Math.min(1, scrollY / 600);
      const stageEl = document.getElementById('hero-dimensional-stage');
      if (stageEl) {
        stageEl.style.setProperty('--hero-scroll', heroShift.toFixed(3));
      }
    }

    // Update 3-Model Race progress when scrolling through #race
    const raceSection = document.getElementById('race');
    if (raceSection && !this.reducedMotion) {
      const rect = raceSection.getBoundingClientRect();
      const vh = window.innerHeight || 800;
      // Progress starts when top of #race enters at 75% viewport height and completes when top reaches -25% vh
      const startY = vh * 0.72;
      const endY = -Math.max(180, rect.height * 0.28);
      const rawP = (startY - rect.top) / Math.max(1, startY - endY);

      if (rect.top < vh && rect.bottom > 0) {
        const clampedP = Math.max(0.18, Math.min(1, rawP));
        this.progress = clampedP;
        this.renderRaceProgress(clampedP);
      }
    }

    // Update Trace Rail playhead
    const tracePlayhead = document.getElementById('trace-playhead-pct');
    const traceFill = document.getElementById('trace-rail-fill');
    if (tracePlayhead) {
      tracePlayhead.textContent = `${Math.round(globalP * 100)
        .toString()
        .padStart(3, '0')}%`;
    }
    if (traceFill) {
      traceFill.style.transform = `scaleX(${globalP.toFixed(3)})`;
    }
  }

  renderRaceProgress(p) {
    const clamped = Math.max(0, Math.min(1, p));
    const pctInt = Math.round(clamped * 100);
    const lang = getLang();
    const scenarios = RACE_SCENARIOS[lang] || RACE_SCENARIOS.de;

    const raceSection = document.getElementById('race');
    if (raceSection) {
      raceSection.style.setProperty('--sc-p', clamped.toFixed(3));
    }

    const scrubber = document.getElementById('race-scrubber');
    if (scrubber && document.activeElement !== scrubber) {
      scrubber.value = String(pctInt);
    }

    const pctReadout = document.getElementById('race-scrubber-pct');
    if (pctReadout) {
      pctReadout.textContent = `${String(pctInt).padStart(3, '0')}%`;
    }

    ['openai', 'claude', 'gemini'].forEach((modelKey) => {
      const item = scenarios[modelKey];
      if (!item) return;

      const totalLen = item.text.length;
      const visibleChars = Math.max(12, Math.round(totalLen * clamped));
      const slice = item.text.slice(0, visibleChars);

      const streamEl = document.getElementById(`race-stream-${modelKey}`);
      const charCountEl = document.getElementById(`race-chars-${modelKey}`);
      const relPosEl = document.getElementById(`race-rel-${modelKey}`);
      const badgeEl = document.getElementById(`race-badge-${modelKey}`);
      const caliperFill = document.getElementById(`race-caliper-${modelKey}`);
      const trackFill = document.getElementById(`race-mobile-fill-${modelKey}`);
      const cardEl = document.querySelector(`[data-race-card="${modelKey}"]`);

      if (streamEl) {
        streamEl.innerHTML = this.formatHighlightedStream(
          slice,
          item.brand,
          item.comp,
          clamped < 1
        );
      }

      const brandReached = item.brandIdx !== -1 && visibleChars >= item.brandIdx + item.brand.length;
      const compReached = item.compIdx !== -1 && visibleChars >= item.compIdx + item.comp.length;

      if (charCountEl) {
        if (brandReached) {
          charCountEl.textContent = String(item.brandIdx).padStart(3, '0');
        } else if (compReached && item.brandIdx === -1) {
          charCountEl.textContent = 'OMIT';
        } else {
          charCountEl.textContent = `${String(visibleChars).padStart(3, '0')}`;
        }
      }

      if (relPosEl) {
        if (brandReached) {
          const rel = ((item.brandIdx / totalLen) * 100).toFixed(1);
          relPosEl.textContent = `${rel}%`;
        } else if (clamped >= 0.85 && item.brandIdx === -1) {
          relPosEl.textContent = '— (0%)';
        } else {
          relPosEl.textContent = '...';
        }
      }

      // Caliper bar progress
      const barPct = Math.round((visibleChars / totalLen) * 100);
      if (caliperFill) {
        caliperFill.style.width = `${barPct}%`;
      }
      if (trackFill) {
        trackFill.style.width = `${barPct}%`;
      }

      // Update MECE badge state when threshold reached
      const resolved = brandReached || (compReached && clamped >= 0.72) || clamped >= 0.9;
      if (badgeEl) {
        if (resolved) {
          badgeEl.textContent = item.mece;
          badgeEl.className = `badge ${this.getMeceClass(item.mece)}`;
        } else {
          badgeEl.textContent = 'SCANNING...';
          badgeEl.className = 'badge mece-generic';
        }
      }

      if (cardEl) {
        cardEl.classList.toggle('race-card-resolved', resolved);
      }
    });
  }

  getMeceClass(mece) {
    if (mece === '1_DIRECT_WIN') return 'mece-direct-win';
    if (mece === '2_BRAND_HALO') return 'mece-brand-halo';
    if (mece === '3_COMPETITOR_TAKEOVER') return 'mece-competitor-takeover';
    return 'mece-generic';
  }

  formatHighlightedStream(text, brand, comp, showCursor) {
    // Strictly escape first, then wrap exact brand/competitor tokens
    let safe = escapeText(text);
    if (brand) {
      const safeBrand = escapeText(brand);
      safe = safe.replace(
        new RegExp(`(${safeBrand})`, 'gi'),
        '<mark class="token-mark token-brand">$1</mark>'
      );
    }
    if (comp) {
      const safeComp = escapeText(comp);
      safe = safe.replace(
        new RegExp(`(${safeComp})`, 'gi'),
        '<mark class="token-mark token-comp">$1</mark>'
      );
    }
    if (showCursor) {
      safe += '<span class="stream-cursor" aria-hidden="true">▋</span>';
    }
    return safe;
  }

  initTraceRail() {
    const sections = [
      { id: 'hero-stage', key: 'hero' },
      { id: 'race', key: 'race' },
      { id: 'simulator', key: 'sim' },
      { id: 'features', key: 'geo' },
      { id: 'pricing', key: 'pricing' },
      { id: 'faq', key: 'faq' }
    ];

    if (!('IntersectionObserver' in window)) return;

    const railLinks = document.querySelectorAll('[data-trace-target]');
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            railLinks.forEach((link) => {
              const active = link.getAttribute('data-trace-target') === id;
              link.classList.toggle('active', active);
            });
          }
        });
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: 0 }
    );

    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
  }
}

export const scrollStage = new ScrollCraftStage();
export default scrollStage;
