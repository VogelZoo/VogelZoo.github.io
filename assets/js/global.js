const currentScript = document.currentScript;
const scriptUrl = currentScript ? currentScript.src : window.location.href;
const baseUrl = new URL('.', scriptUrl);

function getPathPrefix() {
  const siteRoot = new URL('../../', baseUrl).pathname.replace(/\/$/, '');
  const currentPath = window.location.pathname.replace(/\/$/, '');
  if (!currentPath.startsWith(siteRoot)) {
    return './';
  }

  const relativePath = currentPath.slice(siteRoot.length).replace(/^\//, '');
  const segments = relativePath.split('/').filter((segment) => segment.length > 0);
  const depth = Math.max(0, segments.length - 1);
  return './' + '../'.repeat(depth);
}

function normalizeLinks(container) {
  const prefix = getPathPrefix();
  container.querySelectorAll('a[href^="/"]').forEach((link) => {
    link.href = prefix + link.getAttribute('href').replace(/^\//, '');
  });
}

function setActiveNavLink() {
  const currentUrl = new URL(window.location.href);
  document.querySelectorAll('.nav-links a').forEach((link) => {
    const resolved = new URL(link.href, window.location.href);
    const resolvedPath = resolved.pathname.replace(/\/index\.html$/, '/');
    const currentPath = currentUrl.pathname.replace(/\/index\.html$/, '/');
    link.classList.toggle('active', resolvedPath === currentPath);
  });

  // Check if any photography page is active and mark the dropdown
  const photographyLinks = document.querySelectorAll('.dropdown-menu a');
  const isPhotographyActive = Array.from(photographyLinks).some(link => link.classList.contains('active'));
  const photographySummary = document.querySelector('.nav-dropdown summary');
  if (photographySummary) {
    photographySummary.classList.toggle('active', isPhotographyActive);
  }
}

function toggleMobileMenu() {
  const navLinks = document.getElementById('navLinks');
  if (!navLinks) return;
  navLinks.classList.toggle('open');
}

async function insertComponent(targetId, componentPath, fallbackHtml) {
  const target = document.getElementById(targetId);
  if (!target) return;
  try {
    const response = await fetch(componentPath);
    if (!response.ok) throw new Error('Component fetch failed');
    const html = await response.text();
    target.innerHTML = html;
  } catch (error) {
    target.innerHTML = fallbackHtml;
  }
}

function bindNavigation() {
  const toggle = document.getElementById('navToggle');
  if (toggle) {
    toggle.addEventListener('click', toggleMobileMenu);
  }

  // Ensure only one dropdown is open at a time
  document.querySelectorAll('.nav-dropdown').forEach((dropdown) => {
    dropdown.addEventListener('toggle', (event) => {
      if (event.target.open) {
        document.querySelectorAll('.nav-dropdown').forEach((other) => {
          if (other !== event.target) {
            other.open = false;
          }
        });
      }
    });
  });
}

function protectPhotos() {
  if (!window.location.pathname.includes('/photography/')) return;

  document.addEventListener('contextmenu', (event) => {
    if (event.target.closest('.photo-card') || event.target.closest('.rotator-slide')) {
      event.preventDefault();
    }
  });

  document.addEventListener('dragstart', (event) => {
    if (event.target.closest('.photo-card') || event.target.closest('.rotator-slide')) {
      event.preventDefault();
    }
  });
}

function initPhotoRotators() {
  document.querySelectorAll('.photo-rotator').forEach((rotator) => {
    const track = rotator.querySelector('.rotator-track');
    const slides = Array.from(rotator.querySelectorAll('.rotator-slide'));
    const prev = rotator.querySelector('.rotator-prev');
    const next = rotator.querySelector('.rotator-next');
    const indicators = rotator.querySelectorAll('.rotator-indicator');
    let index = 0;

    const update = (newIndex) => {
      index = (newIndex + slides.length) % slides.length;
      track.style.transform = `translateX(-${index * 100}%)`;
      indicators.forEach((dot, dotIndex) => {
        dot.classList.toggle('active', dotIndex === index);
      });
    };

    prev?.addEventListener('click', () => update(index - 1));
    next?.addEventListener('click', () => update(index + 1));

    rotator.dataset.intervalId = setInterval(() => update(index + 1), 5000);
    rotator.addEventListener('mouseenter', () => clearInterval(Number(rotator.dataset.intervalId)));
    rotator.addEventListener('mouseleave', () => {
      rotator.dataset.intervalId = setInterval(() => update(index + 1), 5000);
    });

    update(index);
  });
}

function initSiteShell() {
  const navPath = new URL('../../components/nav.html', baseUrl).href;
  const footerPath = new URL('../../components/footer.html', baseUrl).href;

  const fallbackNav = `
    <nav class="site-nav">
      <button class="nav-toggle" id="navToggle" aria-label="Open site menu" type="button">
        <span></span>
      </button>
      <div class="nav-brand">
        <a class="brand-link" href="/index.html">VogelZoo</a>
        <p class="brand-tag">Creative tools for makers</p>
      </div>
      <div class="nav-links" id="navLinks">
        <a href="/index.html">Home</a>
        <details class="nav-dropdown">
          <summary>Photography</summary>
          <div class="dropdown-menu">
            <a href="/photography/portrait/index.html">Portrait</a>
            <a href="/photography/landscape/index.html">Landscape</a>
            <a href="/photography/aerial/index.html">Aerial</a>
          </div>
        </details>
        <details class="nav-dropdown">
          <summary>3D Printing</summary>
          <div class="dropdown-menu">
            <a href="/3d-printing/ring-generator/index.html">Ring Generator</a>
          </div>
        </details>
        <details class="nav-dropdown">
          <summary>Laser Engraving</summary>
          <div class="dropdown-menu">
            <a href="/laser-engraving/box-generator/index.html">Box Generator</a>
          </div>
        </details>
        <details class="nav-dropdown">
          <summary>Electronics</summary>
          <div class="dropdown-menu">
            <a href="/electronics/robot-arm/index.html">Robot Arm</a>
          </div>
        </details>
      </div>
    </nav>
  `;

  const fallbackFooter = `
    <footer class="site-footer">
      <p>Made by VogelZoo — organized tools for photographers, makers, and designers.</p>
      <p><small>Use a local web server for best results with reusable components and module imports.</small></p>
    </footer>
  `;

  insertComponent('nav-placeholder', navPath, fallbackNav)
    .then(() => {
      normalizeLinks(document);
      bindNavigation();
      setActiveNavLink();
    });
  insertComponent('footer-placeholder', footerPath, fallbackFooter);
}

window.addEventListener('DOMContentLoaded', () => {
  initSiteShell();
  protectPhotos();
  initPhotoRotators();
});
