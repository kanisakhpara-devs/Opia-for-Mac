'use strict';
/* Opia website: theme and language switches, prints that drop onto the desk and settle as you scroll,
   handwritten notes that write themselves, and a little drift on the desk as the page moves. */

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window: the choice lasts this visit */ } } };
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const html = document.documentElement;

/* ---- Spanish; the page is written in English */
const ES = {
  skip: 'Saltar al contenido', 'nav.ws': 'Espacios', 'nav.private': 'Privacidad', 'nav.new': 'Novedades', 'nav.faq': 'Preguntas', 'nav.download': 'Descargar',
  'hero.k': 'Opia para Mac', 'hero.title': 'Crea cosas.<br>Que sigan siendo tuyas<span class="dot" aria-hidden="true"></span>',
  'hero.sub': 'Opia es una app de escritorio para tus fotos, imágenes, vídeos, canciones y PDF. Sin cuenta y sin nube: todo se queda en tu mesa.',
  'hero.download': 'Descargar para Mac', 'hero.github': 'Ver en GitHub', 'hero.note': '↓ cinco espacios, una app',
  'hero.c1': 'Lens · todo el viaje, ordenado', 'hero.c2': 'Imagine · portada', 'hero.c3': 'Motion · 28 segundos de Islandia', 'hero.c4': 'Groove · una banda sonora',
  'ix.1': 'fotos', 'ix.2': 'imágenes', 'ix.3': 'vídeo', 'ix.4': 'música', 'ix.5': 'PDF',
  'lens.k': 'Lens · fotos', 'lens.h': 'Cada foto, ordenada y revelada.', 'lens.p': 'Valora, marca y etiqueta. Encuentra caras, lugares y fotos parecidas. Luego revela: tono, color, curvas, máscaras y correcciones. Tus originales nunca cambian.',
  'lens.1': 'Biblioteca, Revelar, Mapa, Libro', 'lens.2': 'Presentación, Imprimir, Galería web', 'lens.3': 'Exporta a JPEG, TIFF, WebP, AVIF', 'lens.m': '← lo que usarás cada día', 'lens.c': 'atardecer, +0,35 de exposición',
  'imagine.k': 'Imagine · imágenes', 'imagine.h': 'Capas, texto y un pincel.', 'imagine.p': 'Un editor de imágenes al estilo de Photoshop. Apila capas con modos de fusión, recorta, pinta y añade texto y formas que siguen siendo editables.',
  'imagine.1': 'Selecciones, varita mágica, transformación libre', 'imagine.2': 'Niveles, curvas, tono y saturación, en directo', 'imagine.3': 'Abre cualquier foto de Lens con sus ajustes', 'imagine.m': '← tres capas, aún editables', 'imagine.c': 'ISLANDIA, en tres capas',
  'motion.k': 'Motion · vídeo', 'motion.h': 'Móntalo. Exporta un MP4.', 'motion.p': 'Pon clips, imágenes, títulos y música en una línea de tiempo. Recorta, divide, ajusta, funde y encadena, y exporta una película que se ve en cualquier sitio.',
  'motion.1': 'Tantas pistas de vídeo y audio como quieras', 'motion.2': 'Títulos, fundidos encadenados, imagen en imagen', 'motion.3': 'De fotos seleccionadas a vídeo en un clic', 'motion.m': '← ocho fotos, una canción', 'motion.c': 'primer montaje, 0:28',
  'groove.k': 'Groove · música', 'groove.h': 'Canciones, aunque no leas música.', 'groove.p': 'Riffs de batería, bajo, acordes y melodía que siempre encajan. Arrastra tus propios sonidos, graba, corta y añade efectos cuando quieras más.',
  'groove.1': '«Empiézame» esboza una canción entera', 'groove.2': 'Diez instrumentos grabados de verdad', 'groove.3': 'Exporta WAV, MP3, pistas o MIDI', 'groove.m': '← siempre suena afinada', 'groove.c': 'lidio, 68 bpm, soñador',
  'folio.k': 'Folio · PDF', 'folio.h': 'Rellénalo, fírmalo, envíalo.', 'folio.p': 'Escribe en cualquier parte de un PDF, resalta, marca, dibuja tu firma una vez y colócala. Reordena páginas y une archivos e imágenes en uno.',
  'folio.1': 'Campos de formulario reales y firmas', 'folio.2': 'Divide, gira, extrae y combina', 'folio.3': 'Números de página, marcas de agua, contraseñas', 'folio.m': '← ¡reservado!', 'folio.c': 'itinerario, firmado',
  'box.k': 'También incluye', 'box.h': 'Detalles que la hacen agradable.',
  'b1.t': 'Principiante y Avanzado.', 'b1.p': 'Empieza con lo esencial en controles más grandes; activa todos los paneles cuando quieras.',
  'b2.t': 'Cuatro temas.', 'b2.p': 'Opia Dark, Midnight Teal, Porcelain y Lilac Haze.',
  'b3.t': 'Inglés y español.', 'b3.p': 'Cambia de idioma cuando quieras, sin cerrar la app.',
  'b4.t': 'Cómoda con el teclado.', 'b4.p': 'Todos los botones con Tab, menús con F10 y atajos que puedes cambiar.',
  'b5.t': 'Modo panel táctil.', 'b5.p': 'Dos dedos desplazan, al pellizcar se hace zoom, los controles crecen.',
  'b6.t': 'Complementos.', 'b6.p': 'Añade tus propios comandos en Python.',
  'st.ring': 'SE QUEDA EN ESTE ORDENADOR · SE QUEDA EN ESTE ORDENADOR · ',
  'p.k': 'Privada desde el diseño', 'p.h': 'Tus archivos nunca salen de tu mesa.',
  'p.p': 'Opia no tiene cuenta ni nube. Fotos, canciones, vídeos y documentos se quedan en tus carpetas, y los originales nunca cambian. Solo se conecta para los mosaicos del mapa, para las subidas FTP que tú inicies y para buscar actualizaciones si lo permites.',
  'p.m': 'sin registro · sin suscripción · sin conexión',
  'n.h': 'Novedades', n1: 'un editor de imágenes por capas, con selecciones, texto, ajustes y filtros.', n2: 'un editor de vídeo con línea de tiempo, títulos y fundidos que exporta MP4.',
  n3: 'suelta archivos de sonido en la línea de tiempo donde quieras; arrastra clips entre pistas.', 'n4.t': 'Accesibilidad', n4: 'todo accesible con el teclado, nombres para lectores de pantalla, más contraste.',
  n6: 'Lens, Imagine, Folio y Groove en tu teléfono, hechos para el tacto. <a href="https://kanisakhpara-devs.github.io/Opia-for-Android/">Échale un vistazo →</a>', 'n5.t': 'Nombres nuevos', n5: 'Lens, Imagine, Motion, Groove y Folio.', 'n.more': 'el registro de cambios completo →',
  'q.h': 'Preguntas, con respuestas sinceras.',
  q1: '¿Es gratis?', a1: 'Sí. No hay nada que pagar ni cuenta que crear. El proyecto aún no ha elegido una licencia de código abierto, así que por ahora el código se comparte para verlo y ejecutarlo, no para reutilizarlo.',
  q2: '¿Funciona sin conexión?', a2: 'Sí. Todo se ejecuta en tu ordenador. Solo el mapa de Lens necesita internet, para descargar los mosaicos.',
  q3: '¿En qué ordenadores funciona?', a3: 'Macs con Apple silicon (M1 y posteriores) y Macs con procesador Intel; hay una descarga para cada uno. Es una versión alfa: cada versión se abre y se comprueba en los Mac de GitHub, pero aún no se ha probado en muchos Mac reales. Para Windows está <a href="https://kanisakhpara-devs.github.io/Opia-for-Windows/">Opia para Windows</a>.',
  q4: '¿Puede abrir mi catálogo de Lightroom?', a4: 'No. Lens tiene su propio formato de catálogo. Lee archivos XMP, así que las valoraciones, palabras clave y ajustes guardados así se conservan.',
  q5: '¿Cambiará mis archivos originales?', a5: 'No. Los ajustes se guardan aparte, e Imagine, Motion y Folio guardan archivos nuevos. Tus originales solo se sobrescriben si decides guardar encima.',
  q6: '¿Qué no puede hacer?', a6: 'La edición de fotos es de 8 bits, Imagine no admite PSD ni máscaras de capa, Motion no cambia la velocidad ni usa fotogramas clave, y Folio no reescribe el texto de un PDF ni lee escaneos. El README enumera todos los límites.',
  'd.h': 'Consigue Opia para Mac', 'd.p': 'Gratis, para Mac con Apple silicon o Intel.', 'd.btn': 'Descargar para Apple silicon', 'd.btn2': 'Descargar para Mac con Intel',
  'd.note': '¿No sabes cuál? Menú Apple › Acerca de este Mac dice «Chip: Apple M…» o «Procesador: …Intel…». Abre el .dmg y arrastra Opia a Aplicaciones. Opia no está notarizada por Apple, así que la primera vez macOS la detiene: haz clic en <b>OK</b>, abre <b>Ajustes del Sistema › Privacidad y seguridad</b>, haz clic en <b>Abrir igualmente</b> y vuelve a abrir Opia. Después, Ayuda › Buscar actualizaciones la mantiene al día. ¿En Windows? <a href="https://kanisakhpara-devs.github.io/Opia-for-Windows/">Opia para Windows</a>. ¿En el teléfono? <a href="https://kanisakhpara-devs.github.io/Opia-for-Android/">Opia para Android</a>.',
  'ft.p': 'Opia para Mac. Crea cosas. Que sigan siendo tuyas.', 'ft.changelog': 'Registro de cambios', 'ft.help': '¿Necesitas ayuda? Escríbenos por WhatsApp:', 'ft.help2': 'Se prefieren los mensajes; puede que no se contesten las llamadas.', 'ft.releases': 'Versiones',
  'ft.c1': 'Motion usa FFmpeg del paquete imageio-ffmpeg (BSD-2-Clause). El programa ffmpeg que incluye suele ser una versión GPL; si compartes la app con él dentro, la GPL se aplica a esa parte.',
  'ft.c2': 'Muestras de instrumentos: SoundFont Fluid R3 GM, CC BY 3.0. Tipografías: Nunito y Caveat, SIL Open Font License. Herramientas PDF: pypdf y pypdfium2.',
  'ft.c3': 'Las imágenes de las capturas se generaron para esta página; no son fotos reales.',
};
const EN = {};
const T = (k, en) => (html.lang === 'es' && ES[k]) || en;

function setLang(lang) {
  for (const el of $$('[data-i18n]')) {
    const k = el.dataset.i18n; if (!(k in EN)) EN[k] = el.innerHTML;
    el.innerHTML = lang === 'es' && ES[k] ? ES[k] : EN[k];
  }
  html.lang = lang;
  $$('.lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  document.title = lang === 'es' ? 'Opia para Mac: crea cosas, que sigan siendo tuyas' : 'Opia for Mac: make things, keep them yours';
  store.set('opia-site-lang', lang); themeLabel(); fitRing();
}

/* ---- the stamp: stretch or shrink the phrase so its two copies go exactly once round the ring */
function fitRing() {
  const tp = $('.stamp textPath'); if (!tp) return;
  const t = tp.parentNode, C = 2 * Math.PI * 74, n = tp.textContent.length;
  t.style.fontSize = '15.5px'; t.style.letterSpacing = '0px';
  const L = tp.getComputedTextLength(); if (!L) return;
  if (L > C * .8) t.style.fontSize = (15.5 * C * .8 / L) + 'px';     // too long (Spanish): smaller letters, keep some spacing
  t.style.letterSpacing = ((C - tp.getComputedTextLength()) / n) + 'px';
}
if (document.fonts) document.fonts.ready.then(fitRing);
$$('.lang button').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));

/* ---- theme: paper (light) unless the visitor switched to the night desk before */
function themeLabel() {
  const dark = html.dataset.theme === 'dark', es = html.lang === 'es';
  $('.theme').setAttribute('aria-label', dark ? (es ? 'Cambiar al tema claro' : 'Switch to the light theme') : (es ? 'Cambiar al tema oscuro' : 'Switch to the dark theme'));
  $('meta[name=theme-color]').content = dark ? '#191713' : '#efe8da';
}
html.dataset.theme = store.get('opia-site-theme') === 'dark' ? 'dark' : 'light';
$('.theme').addEventListener('click', () => { html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark'; store.set('opia-site-theme', html.dataset.theme); themeLabel(); });
setLang(store.get('opia-site-lang') === 'es' ? 'es' : 'en');

/* ---- the prints drop onto the desk once the page has its pictures */
const drop = () => requestAnimationFrame(() => html.classList.add('loaded'));
if (document.readyState === 'complete') drop(); else addEventListener('load', drop);
setTimeout(drop, 1800);    // slow connection: don't wait for every picture

/* ---- things that settle, write themselves or get stamped as they come into view */
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -14% 0px' });
$$('.settle, .write, .num, .stamp').forEach(el => io.observe(el));
$$('.tick-in').forEach((el, k) => { el.style.transitionDelay = (k * 90) + 'ms'; io.observe(el); });     // the ticks go in one after another

/* ---- scrolling: the desk drifts a little, the header gets its rule, the nav marks where you are */
const prints = $$('.desk .print, .desk .sticker'), topBar = $('.top'), desk = $('.desk');
const navs = $$('.links a').map(a => [a, $(a.getAttribute('href'))]);
let ticking = false;
function onScroll() {
  ticking = false; const y = scrollY, vh = innerHeight;
  topBar.classList.toggle('scrolled', y > 8);
  if (!still && desk && y < vh * 1.4) prints.forEach((p, k) => { p.style.translate = `0 ${(-y * (.05 + (k % 4) * .035)).toFixed(1)}px`; });
  let cur = null; for (const [a, s] of navs) if (s && s.getBoundingClientRect().top < vh * .45) cur = a;
  navs.forEach(([a]) => a.classList.toggle('on', a === cur));
}
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
onScroll();

/* ---- copy the commands */
$('.copy').addEventListener('click', async e => {
  const b = e.currentTarget, code = $('.code code');
  try { await navigator.clipboard.writeText(code.textContent); } catch (err) { const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  b.textContent = T('d.copied', 'Copied'); setTimeout(() => { b.textContent = T('d.copy', 'Copy'); }, 1600);
});
