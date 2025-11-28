import { jsPDF } from 'jspdf';

let fontsLoaded = false;
let fontDataRegular = null;
let fontDataBold = null;

async function loadFonts() {
  if (fontsLoaded) return { regular: fontDataRegular, bold: fontDataBold };
  
  try {
    // DejaVu Sans - excellent Unicode/Cyrillic support, works well with jsPDF
    const [regularResponse, boldResponse] = await Promise.all([
      fetch('https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf'),
      fetch('https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf'),
    ]);
    
    if (!regularResponse.ok || !boldResponse.ok) {
      console.error('Font fetch failed:', regularResponse.status, boldResponse.status);
      return null;
    }
    
    const [regularBuffer, boldBuffer] = await Promise.all([
      regularResponse.arrayBuffer(),
      boldResponse.arrayBuffer(),
    ]);
    
    fontDataRegular = arrayBufferToBase64(regularBuffer);
    fontDataBold = arrayBufferToBase64(boldBuffer);
    fontsLoaded = true;
    return { regular: fontDataRegular, bold: fontDataBold };
  } catch (e) {
    console.error('Failed to load fonts:', e);
    return null;
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

/**
 * Remove markdown formatting for plain text PDF output.
 */
function stripMarkdown(text) {
  if (!text) return '';
  if (typeof text !== 'string') return String(text);
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, (match) => match.replace(/`/g, ''))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^\d+\.\s+/gm, '')
    .trim();
}

/**
 * Split text into lines manually for reliable wrapping.
 */
function wrapTextManual(doc, text, maxWidth) {
  const lines = [];
  const paragraphs = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    
    // Use jsPDF's splitTextToSize for proper text wrapping
    try {
      const wrapped = doc.splitTextToSize(para, maxWidth);
      if (Array.isArray(wrapped)) {
        lines.push(...wrapped);
      } else {
        lines.push(wrapped);
      }
    } catch (e) {
      // Fallback: simple word wrap
      const words = para.split(' ');
      let currentLine = '';
      for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const textWidth = doc.getTextWidth(testLine);
        if (textWidth > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) {
        lines.push(currentLine);
      }
    }
    
    if (i < paragraphs.length - 1 && paragraphs[i + 1].trim()) {
      lines.push('');
    }
  }
  return lines;
}

/**
 * Add text with automatic page breaks.
 */
function addTextWithPageBreak(doc, lines, startY, lineHeight, marginLeft, marginBottom, pageHeight) {
  let y = startY;
  
  for (const line of lines) {
    if (y + lineHeight > pageHeight - marginBottom) {
      doc.addPage();
      y = 25;
    }
    doc.text(line, marginLeft, y);
    y += lineHeight;
  }
  
  return y;
}

/**
 * Export council response to PDF with Cyrillic support.
 */
export async function exportCouncilToPdf(userQuestion, assistantMessage, t) {
  // Load fonts first
  const fonts = await loadFonts();
  
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Register fonts with Cyrillic support
  if (fonts) {
    doc.addFileToVFS('DejaVuSans.ttf', fonts.regular);
    doc.addFileToVFS('DejaVuSans-Bold.ttf', fonts.bold);
    doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
    doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
    doc.setFont('DejaVu', 'normal');
  } else {
    console.warn('Fonts not loaded, PDF may not display Cyrillic correctly');
  }

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLeft = 20;
  const marginRight = 20;
  const marginBottom = 25;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const lineHeight = 6;

  let y = 25;

  // --- PAGE 1: Summary ---
  
  // Title
  doc.setFontSize(22);
  if (fonts) doc.setFont('DejaVu', 'bold');
  doc.setTextColor(30, 58, 138);
  doc.text('Arteus Council', marginLeft, y);
  y += 12;

  // Date
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  if (fonts) doc.setFont('DejaVu', 'normal');
  const now = new Date();
  doc.text(now.toLocaleString(), marginLeft, y);
  y += 14;

  // Question section
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  if (fonts) doc.setFont('DejaVu', 'bold');
  doc.text(t('youLabel') + ':', marginLeft, y);
  y += 8;

  doc.setFontSize(11);
  doc.setTextColor(50, 50, 50);
  if (fonts) doc.setFont('DejaVu', 'normal');
  const questionLines = wrapTextManual(doc, stripMarkdown(userQuestion), contentWidth);
  y = addTextWithPageBreak(doc, questionLines, y, lineHeight, marginLeft, marginBottom, pageHeight);
  y += 10;

  // Final Answer section
  if (assistantMessage.stage3) {
    doc.setFontSize(13);
    doc.setTextColor(30, 58, 138);
    if (fonts) doc.setFont('DejaVu', 'bold');
    const chairmanName = assistantMessage.stage3.model?.split('/')[1] || assistantMessage.stage3.model || 'Chairman';
    doc.text(`${t('stage3Title')} (${chairmanName}):`, marginLeft, y);
    y += 8;

    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    if (fonts) doc.setFont('DejaVu', 'normal');
    const answerLines = wrapTextManual(doc, stripMarkdown(assistantMessage.stage3.response), contentWidth);
    y = addTextWithPageBreak(doc, answerLines, y, lineHeight, marginLeft, marginBottom, pageHeight);
  }

  // --- PAGE 2+: Details ---
  doc.addPage();
  y = 20;

  // Stage 1: Individual Responses
  const stage1Data = assistantMessage.stage1;
  if (stage1Data && (Array.isArray(stage1Data) ? stage1Data.length > 0 : Object.keys(stage1Data).length > 0)) {
    doc.setFontSize(14);
    doc.setTextColor(30, 58, 138);
    if (fonts) doc.setFont('DejaVu', 'bold');
    doc.text(t('stage1Title'), marginLeft, y);
    y += 10;

    const entries = Array.isArray(stage1Data)
      ? stage1Data.map((item) => [item.model, item.response])
      : Object.entries(stage1Data);

    for (const [model, response] of entries) {
      if (y > pageHeight - 40) {
        doc.addPage();
        y = 25;
      }

      const modelName = String(model).split('/')[1] || String(model);
      doc.setFontSize(12);
      doc.setTextColor(60, 60, 60);
      if (fonts) doc.setFont('DejaVu', 'bold');
      doc.text(modelName, marginLeft, y);
      y += 7;

      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      if (fonts) doc.setFont('DejaVu', 'normal');
      const responseText = typeof response === 'string' ? response : String(response || '');
      const responseLines = wrapTextManual(doc, stripMarkdown(responseText), contentWidth);
      y = addTextWithPageBreak(doc, responseLines, y, 5, marginLeft, marginBottom, pageHeight);
      y += 8;
    }
  }

  // Stage 2: Rankings Summary
  if (assistantMessage.metadata?.aggregate_rankings) {
    if (y > pageHeight - 60) {
      doc.addPage();
      y = 25;
    }

    doc.setFontSize(14);
    doc.setTextColor(30, 58, 138);
    if (fonts) doc.setFont('DejaVu', 'bold');
    doc.text(t('aggregateRankings'), marginLeft, y);
    y += 10;

    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    if (fonts) doc.setFont('DejaVu', 'normal');

    const rankings = assistantMessage.metadata.aggregate_rankings;
    const sortedModels = Object.entries(rankings)
      .sort((a, b) => a[1].average - b[1].average);

    for (const [model, data] of sortedModels) {
      if (y > pageHeight - marginBottom) {
        doc.addPage();
        y = 25;
      }
      const modelName = model.split('/')[1] || model;
      const avgText = `${t('avgShort')}: ${data.average.toFixed(2)}, ${t('votes')}: ${data.votes}`;
      doc.text(`${modelName} - ${avgText}`, marginLeft, y);
      y += 7;
    }
  }

  // Save PDF
  const timestamp = now.toISOString().slice(0, 19).replace(/[T:]/g, '-');
  doc.save(`arteus-council-${timestamp}.pdf`);
}
