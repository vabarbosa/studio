// =============================================================================
// MathJax Parser Utilities
// (c) Mathigon
// =============================================================================


const path = require('path');
const entities = require('html-entities');
const mathjax = require('mathjax');
const {CONFIG, readFile, writeFile, warning} = require('../utilities');

const cacheFile = path.join(process.env.HOME, '/.mathjax-cache');
const mathJaxStore = JSON.parse(readFile(cacheFile, '{}'));
let storeChanged = false;

const placeholders = {};
let placeholderCount = 0;
let promise = undefined;

const tex2html = CONFIG.parser.tex2html

function getId (code, isInline) {
  return entities.decode(code) + (isInline || false) + (tex2html ? 'html' : '');
}


module.exports.makeTexPlaceholder = function(code, isInline = false) {
  const id = getId(code, isInline);
  if (id in mathJaxStore) return mathJaxStore[id];

  const placeholder = `XEQUATIONX${placeholderCount++}XEQUATIONX`;
  placeholders[placeholder] = [code, isInline];
  return placeholder;
};

async function texToSvg(code, isInline) {
  const id = getId(code, isInline);
  if (mathJaxStore[id]) return mathJaxStore[id];

  if (!promise) {
    promise = mathjax.init({
      loader: {load: ['input/tex-full', 'output/svg']},
      svg: {}  // http://docs.mathjax.org/en/latest/options/output/svg.html#the-configuration-block
    });
  }

  let output = '';

  try {
    // TODO Use KaTeX for performance, and generate HTML not SVGs
    const MathJax = await promise;
    const svg = await MathJax.tex2svg(code, {display: !isInline});
    output = MathJax.startup.adaptor.innerHTML(svg)
        .replace('role="img" focusable="false"', 'class="mathjax"')
        .replace(/ xmlns(:xlink)?="[^"]+"/g, '')
        .replace('<defs>', `<title>${entities.encode(code).trim()}</title><defs>`);
  } catch (e) {
    warning(`MathJax Error – ${e.message} at "${code}"`);
  }

  storeChanged = true;
  return mathJaxStore[id] = output;
}

async function texToHtml(code, isInline) {
  const id = getId(code, isInline);
  if (mathJaxStore[id]) return mathJaxStore[id];

  if (!promise) {
    promise = mathjax.init({
      options: {
        renderActions: {
          // add the TEX string into the DOM node
          addInputText: [200,
            (doc) => {
              for (const math of doc.math) MathJax.config.addInputText(math, doc);
            },
            (math, doc) => MathJax.config.addInputText(math, doc)
          ]
        }
      },
      addInputText(math, doc) {
        const adaptor = doc.adaptor;
        const text = adaptor.node('mjx-input-tex', {'aria-hidden': true}, [
          adaptor.text(math.start.delim + math.math + math.end.delim)
        ]);
        adaptor.append(math.typesetRoot, text);
      },
      loader: {load: ['input/tex-full', 'output/chtml']},
      // https://docs.mathjax.org/en/latest/options/output/chtml.html#the-configuration-block
      chtml: {
        adaptiveCSS: false,
        fontURL: 'https://cdn.jsdelivr.net/npm/mathjax@3.1.0/es5/output/chtml/fonts/woff-v2'
      }
    });
  }

  let output = '';

  try {
    const MathJax = await promise;
    const adaptor = MathJax.startup.adaptor;

    const html = await MathJax.tex2chtml(code, {display: !isInline});
    output = adaptor.outerHTML(html);
  } catch (e) {
    warning(`  MathJax Error: ${e.message} at "${code}"`);
  }

  storeChanged = true;
  return mathJaxStore[id] = output;
}

module.exports.fillTexPlaceholders = async function(doc) {
  const matches = doc.match(/XEQUATIONX[0-9]+XEQUATIONX/g) || [];
  for (const placeholder of matches) {
    let code = '';
    if (tex2html) {
      code = await texToHtml(...placeholders[placeholder]);
    } else {
      code = await texToSvg(...placeholders[placeholder]);
    }
    doc = doc.replace(placeholder, code);
  }
  return doc;
};

module.exports.writeTexCache = async function() {
  if (storeChanged) await writeFile(cacheFile, JSON.stringify(mathJaxStore));
  storeChanged = false;
};
