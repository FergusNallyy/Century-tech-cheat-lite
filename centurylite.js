// ==UserScript==
// @name         Century Tech Solver Lite
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Lightweight auto-solver for Century Tech
// @author       You
// @match        https://*.century.tech/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=century.tech
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      api.groq.com
// @connect      api.ocr.space
// @connect      *
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// @license      MIT
// ==/UserScript==

(function () {
   'use strict';

   // ============================================================
   //  CONFIGURATION
   // ============================================================
   const CONFIG = {
      groqApiKey: GM_getValue('groq_api_key', ''),
      ocrApiKey: 'K87899142988957',
      ocrFallback: true,
      autoSubmit: true,
      speed: 'fast'
   };

   const SPEEDS = {
      fast: { click: 400, wait: 800, submit: 1000, afterSubmit: 2000 }
   };

   const delay = () => SPEEDS.fast;

   // ============================================================
   //  SELECTORS
   // ============================================================
   const SEL = {
      submitBtn: '[data-testid="button-submit"]',
      skipBtn: '[data-testid="button-skip"]',
      closeNugget: '[data-testid="button-close-nugget"]',
      learningQuestion: '.rc-learning-question',
      questionMain: '.rc-learning-question__main',
      questionQuery: '.rc-learning-question__query',
      questionBox: '.rc-learning-question__box',
      qlaContent: '[data-testid="qla-question-content"]',
      exactQuestion: '[data-testid="exact-answer-question"]',
      mcQuestion: '.multiple-choice-question__question',
      mcContainer: '.multiple-choice-question',
      mcOptions: '.multiple-choice-question__options',
      mcOptionsList: '.multiple-choice-question__optionslist',
      mcOption: '.multiple-choice-list__option',
      mcOptionResponsive: '.multiple-choice-list-responsive__option',
      exactContainer: '[data-testid="exact-answer-container"]',
      exactEquationInput: '[data-testid="exact-answer-equation-input"]',
      exactAnswerQ: '.exact-answer__question',
      guppy: '.guppy',
      inputEquation: '.input-equation',
      equationContent: '.question-content-equation',
      matchingBoard: '.rc-alternative-board-matching',
      matchingAdditionalList: '.rc-matching-additional-list',
      promptAnswerItem: '.rc-prompt-answer-list__item',
      promptAnswerField: '.rc-prompt-answer-pair__field',
      matchingAnswerContainer: '[data-testid="matching-answer-container"]',
      rcDraggableLabelItem: '.rc-draggable-label-item',
      clickSelectItemDrop: '.rc-click-select-item-drop',
      draggable: '.draggable',
      draggableItem: '.draggable__item',
      draggableLabelItem: '.draggable-label-item',
      draggableNodeItem: '.draggable-node-item',
      dropTarget: '.drop-target',
      dropZone: '.drop-zone',
      learningScreen: '.rc-learning-screen',
      learningScreenMain: '.rc-learning-screen__main',
      pageBody: '.rc-page-body',
      slideAssessment: '[data-testid="slide-assessment"]',
      btnSecondary: 'button.btn.btn--secondary'
   };

   // ============================================================
   //  STATE
   // ============================================================
   let isRunning = false;
   let previousHash = null;
   let solveLoopTimer = null;

   // ============================================================
   //  UTILITIES
   // ============================================================
   const wait = ms => new Promise(r => setTimeout(r, ms));
   const jitter = ms => ms + Math.floor((Math.random() - 0.5) * ms * 0.4);
   const q = s => document.querySelector(s);
   const qAll = s => [...document.querySelectorAll(s)];
   const visible = el => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'
         && getComputedStyle(el).visibility !== 'hidden';
   };

   function log(msg) { console.log(`[Century Lite] ${msg}`); }

   function similarity(a, b) {
      const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      const s1 = norm(a), s2 = norm(b);
      if (s1 === s2) return 1;
      if (s1.includes(s2) || s2.includes(s1)) return 0.9;
      const w1 = s1.split(/\s+/).filter(w => w.length > 2);
      const w2 = s2.split(/\s+/).filter(w => w.length > 2);
      const common = w1.filter(x => w2.includes(x));
      return common.length / Math.max(w1.length, w2.length, 1);
   }

   function questionHash(qData) {
      const qt = qData.question.toLowerCase().replace(/\s+/g, '').substring(0, 100);
      const ot = qData.options.map(o => o.text.toLowerCase().replace(/\s+/g, '').substring(0, 20)).join('|');
      return `${qt}_${ot}_${qData.options.length}`;
   }

   function updateStatus(text, color) {
      const el = document.getElementById('ctl-status');
      if (el) { el.textContent = text; el.style.background = color; }
   }

   // ============================================================
   //  QUESTION DETECTION
   // ============================================================
   function detectQuestionType() {
      if (q(SEL.mcContainer) || q(SEL.mcOptions) || q(SEL.mcOptionsList)) return 'multiple-choice';
      if (q(SEL.mcOption) || q(SEL.mcOptionResponsive)) return 'multiple-choice';
      if (q(SEL.matchingBoard) || q(SEL.matchingAdditionalList) || q(SEL.matchingAnswerContainer)) return 'drag-and-drop';
      if (q(SEL.rcDraggableLabelItem) || q(SEL.clickSelectItemDrop)) return 'drag-and-drop';
      if (q(SEL.draggable) || q(SEL.draggableItem) || q(SEL.draggableLabelItem)) return 'drag-and-drop';
      if (q(SEL.dropTarget) || q(SEL.dropZone) || q(SEL.draggableNodeItem)) return 'drag-and-drop';
      if (q(SEL.exactContainer) || q(SEL.exactEquationInput)) return 'exact-answer';
      if (q(SEL.exactAnswerQ) || q(SEL.equationContent)) return 'exact-answer';
      if (q(SEL.guppy) || q(SEL.inputEquation)) return 'exact-answer';
      const mainArea = q(SEL.questionMain) || q(SEL.learningScreenMain) || q(SEL.pageBody);
      if (mainArea) {
         const inputs = mainArea.querySelectorAll('input[type="text"], input:not([type]), textarea');
         const nonHidden = [...inputs].filter(i => visible(i) && !i.closest('#ctl-panel'));
         if (nonHidden.length > 0) return 'exact-answer';
      }
      const generic = findGenericMCOptions();
      if (generic.length >= 2) return 'multiple-choice';
      if (q(SEL.learningQuestion) || q(SEL.slideAssessment)) return 'unknown';
      return null;
   }

   function findGenericMCOptions() {
      const results = [];
      const searchArea = q(SEL.questionMain) || q(SEL.learningScreenMain) || q(SEL.pageBody) || document.body;
      if (!searchArea) return results;

      const ariaOptions = searchArea.querySelectorAll('[role="radio"], [role="option"], [role="checkbox"]');
      const visibleAria = [...ariaOptions].filter(el => visible(el) && !el.closest('#ctl-panel'));
      if (visibleAria.length >= 2) {
         visibleAria.forEach((el, i) => {
            const text = (el.textContent || el.getAttribute('aria-label') || '').trim();
            if (text.length > 0) results.push({ text, element: el, index: i });
         });
         if (results.length >= 2) return results;
      }

      const classGroups = new Map();
      for (const el of searchArea.querySelectorAll('div[class], button[class], label[class]')) {
         if (!visible(el) || el.closest('#ctl-panel')) continue;
         const text = (el.textContent || '').trim();
         if (text.length < 1 || text.length > 300) continue;
         if (/^(submit|skip|close|next|continue|back|cancel|done)$/i.test(text)) continue;
         const cls = el.className;
         if (!cls || typeof cls !== 'string') continue;
         if (!classGroups.has(cls)) classGroups.set(cls, []);
         classGroups.get(cls).push(el);
      }
      let bestGroup = [];
      for (const [, els] of classGroups) {
         if (els.length >= 2 && els.length <= 8 && els.length > bestGroup.length) bestGroup = els;
      }
      if (bestGroup.length >= 2) {
         bestGroup.forEach((el, i) => results.push({ text: (el.textContent || '').trim(), element: el, index: i }));
         return results;
      }
      return results;
   }

   // ============================================================
   //  EXTRACTION
   // ============================================================
   function extractQuestionText() {
      const candidates = [SEL.qlaContent, SEL.exactQuestion, SEL.mcQuestion, SEL.questionQuery, SEL.exactAnswerQ, '.question-content', '.question-text', SEL.questionBox];
      for (const sel of candidates) {
         const el = q(sel);
         if (el && el.textContent.trim().length > 3) return el.textContent.trim();
      }
      const main = q(SEL.questionMain) || q(SEL.learningScreenMain);
      if (main) return main.innerText.trim().substring(0, 600);
      return '';
   }

   function extractMCOptions() {
      const options = [];
      for (const sel of [SEL.mcOption, SEL.mcOptionResponsive]) {
         const els = qAll(sel);
         if (els.length > 0) {
            els.forEach((el, i) => {
               const label = el.querySelector('.multiple-choice-list__input-label') || el.querySelector('label') || el;
               const text = (label.textContent || '').trim();
               if (text.length > 0) options.push({ text, element: el, index: i });
            });
            if (options.length > 0) return options;
         }
      }
      const area = q(SEL.mcContainer) || q(SEL.questionMain);
      if (area) {
         const inputs = area.querySelectorAll('input[type="radio"], input[type="checkbox"]');
         inputs.forEach((inp, i) => {
            const label = inp.closest('label') || inp.parentElement;
            const text = (label.textContent || '').trim();
            if (text.length > 0) options.push({ text, element: label, index: i });
         });
         if (options.length > 0) return options;
      }
      return findGenericMCOptions();
   }

   function extractDragItems() {
      const items = [];
      const additionalContainer = q(SEL.matchingAnswerContainer) || q(SEL.matchingAdditionalList);
      if (additionalContainer) {
         const listItems = additionalContainer.querySelectorAll('.rc-matching-additional-list__item');
         listItems.forEach((listItem, i) => {
            const draggableEl = listItem.querySelector('.rc-draggable-label-item');
            const contentEl = listItem.querySelector('.rc-matching-answer-draggable__content') || listItem;
            const text = (contentEl.textContent || '').trim();
            if (text.length === 0) return;
            const style = getComputedStyle(draggableEl || listItem);
            if (style.display === 'none' || style.visibility === 'hidden') return;
            const el = draggableEl || listItem;
            const computedOpacity = parseFloat(getComputedStyle(el).opacity);
            const isGreyed = computedOpacity > 0 && computedOpacity < 0.9;
            const isInactive = draggableEl && !draggableEl.classList.contains('rc-draggable-label-item__active');
            if (isGreyed || isInactive) return;
            items.push({ text, element: contentEl, index: i });
         });
         if (items.length > 0) return items;
      }
      const rcDraggables = qAll(SEL.rcDraggableLabelItem);
      if (rcDraggables.length > 0) {
         rcDraggables.forEach((el, i) => {
            if (el.closest(SEL.promptAnswerItem)) return;
            if (!el.classList.contains('rc-draggable-label-item__active')) return;
            const contentEl = el.querySelector('.rc-matching-answer-draggable__content') || el;
            const text = (contentEl.textContent || '').trim();
            if (text.length > 0) items.push({ text, element: contentEl, index: i });
         });
         if (items.length > 0) return items;
      }
      for (const sel of ['.draggable__item', '.draggable-label-item', '.draggable-node-item', '.draggable__content']) {
         qAll(sel).forEach((el, i) => {
            const text = (el.textContent || '').trim();
            if (text.length > 0) items.push({ text, element: el, index: i });
         });
         if (items.length > 0) break;
      }
      return items;
   }

   function extractDropTargets() {
      const targets = [];
      const promptAnswerItems = qAll(SEL.promptAnswerItem);
      if (promptAnswerItems.length > 0) {
         promptAnswerItems.forEach((item, i) => {
            const fields = item.querySelectorAll(SEL.promptAnswerField);
            if (fields.length >= 1) {
               const promptEl = fields[0];
               const dropEl = fields.length >= 2 ? fields[1] : promptEl;
               const promptText = (promptEl.textContent || '').trim();
               const dropContent = dropEl.querySelector('.rc-matching-answer-draggable__content');
               const filledText = dropContent ? (dropContent.textContent || '').trim() : '';
               if (filledText.length > 0) return;
               targets.push({ text: promptText, element: dropEl, promptElement: promptEl, index: i });
            }
         });
         if (targets.length > 0) return targets;
      }
      for (const sel of [SEL.dropTarget, SEL.dropZone, '.draggable__target']) {
         qAll(sel).forEach((el, i) => targets.push({ text: (el.textContent || '').trim(), element: el, index: i }));
         if (targets.length > 0) break;
      }
      return targets;
   }

   function buildQuestionData() {
      let type = detectQuestionType();
      const question = extractQuestionText();
      let options = [];
      if (type === 'multiple-choice' || type === 'unknown') {
         options = extractMCOptions();
         if (options.length >= 2 && type === 'unknown') type = 'multiple-choice';
      }
      const dragItems = type === 'drag-and-drop' ? extractDragItems() : [];
      const dropTargets = type === 'drag-and-drop' ? extractDropTargets() : [];
      return { type, question, options, dragItems, dropTargets };
   }

   // ============================================================
   //  AI — GROQ ONLY
   // ============================================================
   function askGroq(prompt, systemPrompt, maxTokens) {
      return new Promise((resolve, reject) => {
         GM_xmlhttpRequest({
            method: 'POST',
            url: 'https://api.groq.com/openai/v1/chat/completions',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.groqApiKey}` },
            data: JSON.stringify({
               model: 'meta-llama/llama-4-scout-17b-16e-instruct',
               messages: [
                  { role: 'system', content: systemPrompt || 'GCSE expert. Be concise.' },
                  { role: 'user', content: prompt }
               ],
               temperature: 0.2,
               max_tokens: maxTokens || 256
            }),
            timeout: 30000,
            onload: res => {
               try {
                  const json = JSON.parse(res.responseText);
                  const text = json.choices?.[0]?.message?.content?.trim();
                  if (text) resolve(text);
                  else reject(new Error('Empty response'));
               } catch (e) { reject(e); }
            },
            onerror: reject,
            ontimeout: () => reject(new Error('Timeout'))
         });
      });
   }

   // ============================================================
   //  OCR FALLBACK
   // ============================================================
   async function ocrFallback() {
      if (!CONFIG.ocrFallback) return null;
      try {
         const area = q(SEL.learningScreenMain) || q(SEL.questionMain) || document.body;
         const canvas = await html2canvas(area, { scale: 1, useCORS: true, logging: false });
         const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
         const formData = new FormData();
         formData.append('file', blob, 'screen.png');
         formData.append('apikey', CONFIG.ocrApiKey);
         formData.append('language', 'eng');
         formData.append('isOverlayRequired', 'false');
         return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
               method: 'POST', url: 'https://api.ocr.space/parse/image', data: formData,
               onload: res => {
                  try { resolve(JSON.parse(res.responseText).ParsedResults?.[0]?.ParsedText || ''); }
                  catch (e) { reject(e); }
               },
               onerror: reject
            });
         });
      } catch { return null; }
   }

   function extractFinalAnswer(raw) {
      if (!raw) return null;
      const clean = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      // Reject if AI returned a literal placeholder like <answer> or [answer]
      if (/^[<\[]\s*answer\s*[>\]][".]?$/i.test(clean)) return null;
      const answerMatch = clean.match(/ANSWER:\s*(.+?)$/im);
      if (answerMatch) {
         const candidate = answerMatch[1].trim();
         if (/^[<\[]\s*answer\s*[>\]]/i.test(candidate)) return null;
         return candidate;
      }
      const lines = clean.split('\n').filter(l => l.trim().length > 0);
      const last = lines[lines.length - 1]?.trim() || clean;
      if (/^[<\[]\s*answer\s*[>\]]/i.test(last)) return null;
      return last;
   }

   // ============================================================
   //  SOLVERS
   // ============================================================
   async function solveMultipleChoice(qData) {
      const { question, options } = qData;
      if (!question || options.length === 0) return false;

      const optionTexts = options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o.text}`).join('\n');
      const prompt = `Q: ${question}\nOptions:\n${optionTexts}\n\nReply with ONLY the letter (A, B, C, or D).`;

      let aiAnswer;
      try {
         aiAnswer = await askGroq(prompt, 'Choose the BEST answer. Reply with ONLY the letter.', 32);
      } catch {
         const ocrText = await ocrFallback();
         if (ocrText) {
            try { aiAnswer = await askGroq(`OCR: "${ocrText}"\n${prompt}`, 'Choose the BEST answer. Reply with ONLY the letter.', 32); }
            catch { aiAnswer = 'A'; }
         } else { aiAnswer = 'A'; }
      }

      const clean = aiAnswer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      let selectedIndex = -1;
      const letterMatch = clean.match(/^([A-Z])[).\s]?$/i) || clean.match(/([A-Z])[).\s]/i);
      if (letterMatch) {
         const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
         if (idx >= 0 && idx < options.length) selectedIndex = idx;
      }
      if (selectedIndex === -1) {
         let bestScore = 0;
         options.forEach((o, i) => {
            const score = similarity(clean, o.text);
            if (score > bestScore) { bestScore = score; selectedIndex = i; }
         });
      }
      if (selectedIndex === -1) selectedIndex = 0;

      // Highlight options
      options.forEach((option, i) => {
         const el = option.element;
         el.style.transition = 'all 0.3s ease';
         if (i === selectedIndex) {
            el.style.backgroundColor = '#C8E6C9';
            el.style.border = '3px solid #43A047';
            el.style.color = '#1B5E20';
         } else {
            el.style.opacity = '0.5';
         }
      });

      const clickTarget = options[selectedIndex].element.querySelector('input') ||
         options[selectedIndex].element.querySelector('label') ||
         options[selectedIndex].element;
      await wait(400);
      clickTarget.click();
      clickTarget.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(jitter(delay().click));
      if (CONFIG.autoSubmit) await clickSubmit();
      return true;
   }

   async function solveExactAnswer(qData) {
      const { question } = qData;
      if (!question) return false;

      // If the question asks to pick a letter (A/B/C/D), send a cleaner prompt
      const isLetterQuestion = /which letter/i.test(question) ||
                               /letter \(A/i.test(question) ||
                               /\(A,?\s*B,?\s*C/i.test(question);

      const prompt = isLetterQuestion
         ? `${question}\n\nReply with ONLY the single correct letter: A, B, C, or D.`
         : `${question}\n\nReply with ONLY the final answer on the last line as: ANSWER: your answer here`;

      const systemPrompt = isLetterQuestion
         ? 'You are a GCSE tutor. Reply with a single letter only: A, B, C, or D.'
         : 'GCSE expert. Last line must be "ANSWER: " followed by the actual answer. Never use placeholders like <answer>.';

      let rawAnswer;
      try {
         rawAnswer = await askGroq(prompt, systemPrompt, 64);
      } catch {
         const ocrText = await ocrFallback();
         if (ocrText) {
            try { rawAnswer = await askGroq(`Page text:\n${ocrText}\n\n${prompt}`, systemPrompt, 64); }
            catch { return false; }
         } else { return false; }
      }

      const answer = extractFinalAnswer(rawAnswer);
      if (!answer) {
         log('AI returned placeholder or empty — skipping hint');
         return false;
      }
      showHint(answer);
      return true;
   }

   async function solveMatchingDragDrop(qData) {
      const { question, dragItems, dropTargets } = qData;
      if (dragItems.length === 0) return false;

      log(`${dragItems.length} item(s), ${dropTargets.length} empty slot(s)`);

      const itemTexts = dragItems.map((d, i) => `Answer ${i + 1}: "${d.text}"`).join('\n');
      let prompt;
      if (dropTargets.length > 0) {
         const pairs = dropTargets.map((t, i) => `Slot ${i + 1}: "${t.text}"`).join('\n');
         prompt = `Each slot is the START of a sentence. Each answer is the END. Match each slot to the answer that correctly completes it.\n\nContext: ${question}\n\nSlots:\n${pairs}\n\nAnswers:\n${itemTexts}\n\nRules: each answer used exactly once. Reply ONLY as:\nSlot 1: Answer N\nSlot 2: Answer N\n(${dropTargets.length} lines, no explanations)`;
      } else {
         prompt = `Q: ${question}\n\nItems:\n${itemTexts}\n\nReply ONLY as:\nSlot 1: Answer N\n(${dragItems.length} lines)`;
      }

      let aiAnswer = '';
      try {
         aiAnswer = await askGroq(prompt, 'You are completing sentence-matching exercises. Match each sentence start to its correct ending based purely on logical sentence completion.', 256);
      } catch { log('AI failed for drag-drop'); }

      // Parse response
      const lines = aiAnswer.split('\n').filter(l => l.trim().length > 0);
      const matchMap = new Map();
      lines.forEach((line, lineIdx) => {
         const slotMatch = line.match(/slot\s*(\d+)\s*:?\s*answer\s*(\d+)/i);
         if (slotMatch) {
            const slotIdx = parseInt(slotMatch[1]) - 1;
            const ansIdx = parseInt(slotMatch[2]) - 1;
            if (slotIdx >= 0 && slotIdx < dropTargets.length && ansIdx >= 0 && ansIdx < dragItems.length)
               matchMap.set(slotIdx, ansIdx);
         } else if (lineIdx < dropTargets.length) {
            const m = line.match(/(\d+)/);
            if (m) {
               const ansIdx = parseInt(m[1]) - 1;
               if (ansIdx >= 0 && ansIdx < dragItems.length) matchMap.set(lineIdx, ansIdx);
            }
         }
      });

      // Fill any missed slots by similarity
      for (let i = 0; i < dropTargets.length; i++) {
         if (!matchMap.has(i)) {
            let best = -1, bestScore = -1;
            dragItems.forEach((item, idx) => {
               const score = similarity(dropTargets[i].text, item.text);
               if (score > bestScore) { bestScore = score; best = idx; }
            });
            if (best >= 0) matchMap.set(i, best);
         }
      }

      // Color code items
      const COLORS = [
         { bg: '#FFCDD2', border: '#E53935' },
         { bg: '#C8E6C9', border: '#43A047' },
         { bg: '#BBDEFB', border: '#1E88E5' },
         { bg: '#FFF9C4', border: '#FDD835' },
         { bg: '#E1BEE7', border: '#8E24AA' },
         { bg: '#FFE0B2', border: '#FB8C00' },
      ];

      const itemToSlot = new Map();
      for (const [slotIdx, itemIdx] of matchMap) itemToSlot.set(itemIdx, slotIdx);

      dragItems.forEach((item, i) => {
         const el = item.element;
         el.style.position = 'relative';
         el.style.transition = 'all 0.3s ease';
         const slotIdx = itemToSlot.get(i);
         if (typeof slotIdx === 'number') {
            const c = COLORS[slotIdx % COLORS.length];
            el.style.backgroundColor = c.bg;
            el.style.border = `3px solid ${c.border}`;
            const badge = document.createElement('div');
            badge.style.cssText = `position:absolute;top:-8px;right:-8px;width:20px;height:20px;border-radius:50%;background:${c.border};color:white;font-size:11px;font-weight:bold;display:flex;align-items:center;justify-content:center;z-index:9999;pointer-events:none;`;
            badge.textContent = slotIdx + 1;
            el.appendChild(badge);
         } else {
            el.style.opacity = '0.4';
         }
      });

      dropTargets.forEach((target, i) => {
         const c = COLORS[i % COLORS.length];
         target.element.style.border = `3px dashed ${c.border}`;
         target.element.style.backgroundColor = `${c.bg}40`;
         const badge = document.createElement('div');
         badge.style.cssText = `position:absolute;top:-8px;left:-8px;width:20px;height:20px;border-radius:50%;background:${c.border};color:white;font-size:11px;font-weight:bold;display:flex;align-items:center;justify-content:center;z-index:9999;pointer-events:none;`;
         badge.textContent = i + 1;
         target.element.style.position = 'relative';
         target.element.appendChild(badge);
      });

      return true;
   }

   // ============================================================
   //  SUBMIT & NAVIGATION
   // ============================================================
   async function clickSubmit() {
      await wait(jitter(delay().submit));
      const submitBtn = q(SEL.submitBtn);
      if (submitBtn && !submitBtn.disabled && visible(submitBtn)) {
         submitBtn.click();
         await wait(jitter(delay().afterSubmit));
         return true;
      }
      for (const btn of qAll('button')) {
         const txt = (btn.textContent || '').trim().toLowerCase();
         if ((txt.includes('submit') || txt.includes('check')) && !btn.disabled && visible(btn)) {
            btn.click();
            await wait(jitter(delay().afterSubmit));
            return true;
         }
      }
      return false;
   }

   async function clickContinue() {
      const testIds = ['[data-testid="button-close-nugget"]', '[data-testid="button-next"]', '[data-testid="button-continue"]', '[data-testid="button-start"]'];
      for (const sel of testIds) {
         const btn = q(sel);
         if (btn && !btn.disabled && visible(btn)) { btn.click(); await wait(jitter(delay().afterSubmit)); return true; }
      }
      for (const btn of qAll('button')) {
         if (btn.closest('#ctl-panel')) continue;
         const txt = (btn.textContent || '').trim().toLowerCase();
         if (['continue', 'next', 'got it', 'done', 'try again'].some(w => txt.includes(w))) {
            btn.click(); await wait(jitter(delay().afterSubmit)); return true;
         }
      }
      return false;
   }

   // ============================================================
   //  HINT OVERLAY
   // ============================================================
   function showHint(answer) {
      const existing = document.getElementById('ctl-hint');
      if (existing) existing.remove();

      const wrapper = document.createElement('div');
      wrapper.id = 'ctl-hint';
      wrapper.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#111;color:#d4d4d8;padding:14px 20px;border-radius:8px;z-index:999999;font-size:13px;box-shadow:0 6px 30px rgba(0,0,0,0.6);max-width:500px;text-align:center;font-family:system-ui,sans-serif;';

      const label = document.createElement('div');
      label.style.cssText = 'font-size:10px;color:#555;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;';
      label.textContent = 'Type this answer';

      const answerEl = document.createElement('div');
      answerEl.style.cssText = 'font-size:20px;font-weight:700;color:#4ade80;padding:8px 14px;background:#09090b;border-radius:6px;margin-bottom:10px;cursor:text;user-select:all;word-break:break-word;';
      answerEl.textContent = answer;

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;justify-content:center;';

      const copyBtn = document.createElement('button');
      copyBtn.textContent = 'Copy';
      copyBtn.style.cssText = 'padding:6px 16px;border:none;border-radius:5px;background:#22c55e;color:#052e16;cursor:pointer;font-size:11px;font-weight:600;';
      copyBtn.addEventListener('click', () => {
         navigator.clipboard.writeText(answer).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = answer; ta.style.cssText = 'position:fixed;opacity:0;';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy');
            document.body.removeChild(ta);
         });
         copyBtn.textContent = 'Copied!';
         setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      });

      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close';
      closeBtn.style.cssText = 'padding:6px 16px;border:none;border-radius:5px;background:#27272a;color:#a1a1aa;cursor:pointer;font-size:11px;font-weight:600;';
      closeBtn.addEventListener('click', () => wrapper.remove());

      btnRow.appendChild(copyBtn);
      btnRow.appendChild(closeBtn);
      wrapper.appendChild(label);
      wrapper.appendChild(answerEl);
      wrapper.appendChild(btnRow);
      document.body.appendChild(wrapper);
   }

   // ============================================================
   //  MAIN LOOP
   // ============================================================
   async function solveCurrentQuestion() {
      if (!isRunning) return;
      const type = detectQuestionType();
      if (!type) { await clickContinue(); return; }

      const qData = buildQuestionData();
      const hash = questionHash(qData);
      if (hash === previousHash) { await clickContinue(); return; }
      previousHash = hash;

      updateStatus('Solving...', '#1d4ed8');
      log(`Detected: ${type} | "${qData.question.substring(0, 60)}"`);

      try {
         let success = false;
         if (type === 'multiple-choice') success = await solveMultipleChoice(qData);
         else if (type === 'exact-answer') success = await solveExactAnswer(qData);
         else if (type === 'drag-and-drop') success = await solveMatchingDragDrop(qData);
         else {
            // unknown — try MC options one more time
            qData.options = extractMCOptions();
            if (qData.options.length >= 2) success = await solveMultipleChoice(qData);
         }
         updateStatus(success ? 'Solved ✓' : 'Could not solve', success ? '#15803d' : '#b45309');
      } catch (e) {
         log(`Error: ${e.message}`);
         updateStatus('Error', '#dc2626');
      }
   }

   function startAutoSolving() {
      if (isRunning) return;
      isRunning = true;
      updateStatus('Running...', '#1d4ed8');
      updateBtn();
      solveCurrentQuestion();
      solveLoopTimer = setInterval(() => { if (isRunning) solveCurrentQuestion(); }, 4000);
   }

   function stopAutoSolving() {
      isRunning = false;
      if (solveLoopTimer) { clearInterval(solveLoopTimer); solveLoopTimer = null; }
      updateStatus('Stopped', '#3f3f46');
      updateBtn();
   }

   // ============================================================
   //  MINIMAL UI PANEL
   // ============================================================
   function buildPanel() {
      if (document.getElementById('ctl-panel')) return;
      const panel = document.createElement('div');
      panel.id = 'ctl-panel';

      const savedKey = GM_getValue('groq_api_key', '');
      const hasKey = savedKey.length > 0;

      panel.innerHTML = `
         <style>
            #ctl-panel {
               position: fixed; top: 10px; right: 10px; z-index: 99999;
               width: 210px; background: #111113; border-radius: 8px;
               box-shadow: 0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06);
               font-family: system-ui, sans-serif; font-size: 12px; overflow: hidden;
            }
            #ctl-header {
               background: #18181b; padding: 8px 12px; display: flex;
               justify-content: space-between; align-items: center; cursor: move;
               border-bottom: 1px solid rgba(255,255,255,0.06);
            }
            #ctl-header span { color: #fafafa; font-size: 12px; font-weight: 600; }
            #ctl-hide { background: none; border: none; color: #71717a; cursor: pointer; font-size: 13px; padding: 0 4px; }
            #ctl-body { padding: 10px 12px; }
            #ctl-status {
               padding: 4px 8px; border-radius: 4px; margin-bottom: 8px;
               font-size: 11px; text-align: center; font-weight: 500; color: white;
               background: #3f3f46;
            }
            #ctl-start {
               width: 100%; padding: 7px; border: none; border-radius: 5px;
               cursor: pointer; font-size: 12px; font-weight: 600;
               background: #22c55e; color: #052e16; margin-bottom: 6px;
            }
            #ctl-once {
               width: 100%; padding: 5px; border: 1px solid rgba(255,255,255,0.08);
               border-radius: 5px; cursor: pointer; font-size: 11px; font-weight: 600;
               background: #27272a; color: #a1a1aa; margin-bottom: 10px;
            }
            .ctl-divider {
               border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 8px 0;
            }
            .ctl-section-title {
               font-size: 10px; color: #52525b; text-transform: uppercase;
               letter-spacing: 0.8px; font-weight: 600; margin-bottom: 5px;
            }
            #ctl-key-input {
               width: 100%; background: #18181b; color: #d4d4d8;
               border: 1px solid rgba(255,255,255,0.08); border-radius: 5px;
               padding: 5px 8px; font-size: 11px; box-sizing: border-box;
               outline: none; margin-bottom: 5px;
            }
            #ctl-key-input:focus { border-color: rgba(59,130,246,0.4); }
            #ctl-key-input::placeholder { color: #52525b; }
            .ctl-key-btns { display: flex; gap: 5px; margin-bottom: 6px; }
            .ctl-key-btns button {
               flex: 1; padding: 5px; border: none; border-radius: 4px;
               cursor: pointer; font-size: 10px; font-weight: 600;
            }
            #ctl-save-key { background: #3b82f6; color: white; }
            #ctl-clear-key { background: #27272a; color: #a1a1aa; border: 1px solid rgba(255,255,255,0.08) !important; }
            #ctl-key-status { font-size: 10px; margin-bottom: 6px; }
            #ctl-how-link {
               font-size: 10px; color: #60a5fa; cursor: pointer; text-decoration: underline;
               background: none; border: none; padding: 0; display: block; margin-bottom: 2px;
            }
            #ctl-instructions {
               display: none; background: #09090b; border-radius: 5px;
               padding: 8px; font-size: 10px; color: #a1a1aa; line-height: 1.6;
               border: 1px solid rgba(255,255,255,0.04); margin-top: 5px;
            }
            #ctl-instructions a { color: #60a5fa; }
            #ctl-instructions ol { margin: 4px 0 0 0; padding-left: 14px; }
            #ctl-instructions li { margin-bottom: 3px; }
         </style>
         <div id="ctl-header">
            <span>Century Lite</span>
            <button id="ctl-hide">−</button>
         </div>
         <div id="ctl-body">
            <div id="ctl-status">${hasKey ? 'Stopped' : 'No API key'}</div>
            <button id="ctl-start" ${hasKey ? '' : 'disabled style="opacity:0.4;cursor:not-allowed;"'}>Start</button>
            <button id="ctl-once" ${hasKey ? '' : 'disabled style="opacity:0.4;cursor:not-allowed;"'}>Solve Once</button>
            <hr class="ctl-divider">
            <div class="ctl-section-title">Groq API Key</div>
            <input id="ctl-key-input" type="password" placeholder="${hasKey ? '●●●● saved ●●●●' : 'Paste your key here'}">
            <div class="ctl-key-btns">
               <button id="ctl-save-key">Save</button>
               <button id="ctl-clear-key">Clear</button>
            </div>
            <div id="ctl-key-status" style="color:${hasKey ? '#4ade80' : '#f87171'}">
               ${hasKey ? '✓ Key saved' : '✗ No key set'}
            </div>
            <button id="ctl-how-link">How do I get a key?</button>
            <div id="ctl-instructions">
               <strong style="color:#fafafa;">Getting a free Groq key:</strong>
               <ol>
                  <li>Go to <a href="https://console.groq.com" target="_blank">console.groq.com</a></li>
                  <li>Click <strong>Sign Up</strong> — it's free</li>
                  <li>Once logged in, click <strong>API Keys</strong> in the left menu</li>
                  <li>Click <strong>Create API Key</strong>, give it any name</li>
                  <li>Copy the key shown (starts with <code>gsk_</code>)</li>
                  <li>Paste it in the box above and click <strong>Save</strong></li>
               </ol>
               <div style="margin-top:5px;color:#71717a;">The key is stored locally in Tampermonkey — it never leaves your browser except to call Groq.</div>
            </div>
         </div>`;

      document.body.appendChild(panel);

      // Start / Solve Once
      document.getElementById('ctl-start').addEventListener('click', () => isRunning ? stopAutoSolving() : startAutoSolving());
      document.getElementById('ctl-once').addEventListener('click', () => solveCurrentQuestion());

      // Collapse
      document.getElementById('ctl-hide').addEventListener('click', () => {
         const body = document.getElementById('ctl-body');
         const hidden = body.style.display === 'none';
         body.style.display = hidden ? '' : 'none';
         document.getElementById('ctl-hide').textContent = hidden ? '−' : '+';
      });

      // Save key
      document.getElementById('ctl-save-key').addEventListener('click', () => {
         const val = document.getElementById('ctl-key-input').value.trim();
         if (!val) return;
         GM_setValue('groq_api_key', val);
         CONFIG.groqApiKey = val;
         document.getElementById('ctl-key-input').value = '';
         document.getElementById('ctl-key-input').placeholder = '●●●● saved ●●●●';
         document.getElementById('ctl-key-status').textContent = '✓ Key saved';
         document.getElementById('ctl-key-status').style.color = '#4ade80';
         document.getElementById('ctl-start').disabled = false;
         document.getElementById('ctl-start').style.opacity = '1';
         document.getElementById('ctl-start').style.cursor = 'pointer';
         document.getElementById('ctl-once').disabled = false;
         document.getElementById('ctl-once').style.opacity = '1';
         document.getElementById('ctl-once').style.cursor = 'pointer';
         updateStatus('Stopped', '#3f3f46');
      });

      // Clear key
      document.getElementById('ctl-clear-key').addEventListener('click', () => {
         GM_setValue('groq_api_key', '');
         CONFIG.groqApiKey = '';
         document.getElementById('ctl-key-input').value = '';
         document.getElementById('ctl-key-input').placeholder = 'Paste your key here';
         document.getElementById('ctl-key-status').textContent = '✗ No key set';
         document.getElementById('ctl-key-status').style.color = '#f87171';
         document.getElementById('ctl-start').disabled = true;
         document.getElementById('ctl-start').style.opacity = '0.4';
         document.getElementById('ctl-start').style.cursor = 'not-allowed';
         document.getElementById('ctl-once').disabled = true;
         document.getElementById('ctl-once').style.opacity = '0.4';
         document.getElementById('ctl-once').style.cursor = 'not-allowed';
         if (isRunning) stopAutoSolving();
         updateStatus('No API key', '#3f3f46');
      });

      // Toggle instructions
      document.getElementById('ctl-how-link').addEventListener('click', () => {
         const instr = document.getElementById('ctl-instructions');
         instr.style.display = instr.style.display === 'none' ? 'block' : 'none';
      });

      // Draggable
      const header = document.getElementById('ctl-header');
      let startX, startY, elX, elY, dragging = false;
      header.addEventListener('mousedown', e => {
         const r = panel.getBoundingClientRect();
         elX = r.left; elY = r.top; startX = e.clientX; startY = e.clientY; dragging = true;
         panel.style.transition = 'none';
      });
      document.addEventListener('mousemove', e => {
         if (!dragging) return;
         elX += e.clientX - startX; elY += e.clientY - startY;
         startX = e.clientX; startY = e.clientY;
         panel.style.left = elX + 'px'; panel.style.top = elY + 'px'; panel.style.right = 'auto';
      });
      document.addEventListener('mouseup', () => { dragging = false; panel.style.transition = ''; });
   }

   function updateBtn() {
      const btn = document.getElementById('ctl-start');
      if (!btn) return;
      btn.textContent = isRunning ? 'Stop' : 'Start';
      btn.style.background = isRunning ? '#ef4444' : '#22c55e';
      btn.style.color = isRunning ? '#fff' : '#052e16';
   }

   // ============================================================
   //  KEYBOARD SHORTCUT  Ctrl+H = hide
   // ============================================================
   document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
         e.preventDefault();
         const panel = document.getElementById('ctl-panel');
         if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
      }
   }, true);

   // ============================================================
   //  SPA NAVIGATION + INIT
   //  Century Tech is a React SPA — URL changes without page reload.
   //  We detect navigation via window.navigation API (Chrome 102+)
   //  and MutationObserver as a fallback.
   // ============================================================
   let lastUrl = location.href;

   function onNavigate() {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      log(`SPA navigation detected: ${location.href}`);
      // Stop any running solver so it restarts fresh on the new page
      if (isRunning) stopAutoSolving();
      previousHash = null;
      // Rebuild panel if it was removed by React re-rendering the DOM
      setTimeout(() => buildPanel(), 800);
   }

   function init() {
      buildPanel();
      log('Century Lite ready. Ctrl+H to hide.');

      // Method 1: modern Navigation API (Chrome 102+)
      if (window.navigation) {
         window.navigation.addEventListener('navigate', onNavigate);
      }

      // Method 2: intercept pushState / replaceState (covers older browsers + React Router)
      const _push = history.pushState.bind(history);
      const _replace = history.replaceState.bind(history);
      history.pushState = (...args) => { _push(...args); onNavigate(); };
      history.replaceState = (...args) => { _replace(...args); onNavigate(); };
      window.addEventListener('popstate', onNavigate);

      // Method 3: MutationObserver on <body> to catch React root re-renders
      // that might wipe our panel
      const bodyObserver = new MutationObserver(() => {
         if (!document.getElementById('ctl-panel')) {
            log('Panel removed by SPA re-render, rebuilding...');
            buildPanel();
         }
      });
      bodyObserver.observe(document.body, { childList: true });
   }

   const checkReady = setInterval(() => {
      if (document.body) {
         clearInterval(checkReady);
         init();
      }
   }, 500);

})();
