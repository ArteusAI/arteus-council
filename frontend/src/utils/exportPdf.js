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
 * Parse inline markdown (bold, italic) into segments with style info.
 */
function parseInlineMarkdown(text) {
  if (!text) return [{ text: '', style: 'normal' }];
  
  const segments = [];
  // Regex to match **bold**, *italic*, __bold__, _italic_, `code`, and [link](url)
  const regex = /(\*\*(.+?)\*\*)|(__(.+?)__)|(\*(.+?)\*)|(_([^_]+)_)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    // Add text before the match as normal
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), style: 'normal' });
    }
    
    if (match[1]) {
      // **bold**
      segments.push({ text: match[2], style: 'bold' });
    } else if (match[3]) {
      // __bold__
      segments.push({ text: match[4], style: 'bold' });
    } else if (match[5]) {
      // *italic*
      segments.push({ text: match[6], style: 'italic' });
    } else if (match[7]) {
      // _italic_
      segments.push({ text: match[8], style: 'italic' });
    } else if (match[9]) {
      // `code`
      segments.push({ text: match[10], style: 'code' });
    } else if (match[11]) {
      // [link](url)
      segments.push({ text: match[12], style: 'normal' });
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), style: 'normal' });
  }
  
  if (segments.length === 0) {
    segments.push({ text: text, style: 'normal' });
  }
  
  return segments;
}

/**
 * Parse a line and determine its type (heading, list item, paragraph).
 */
function parseLineType(line) {
  if (!line || typeof line !== 'string') {
    return { type: 'paragraph', content: '', level: 0 };
  }
  
  // Check for headings
  const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
  if (headingMatch) {
    return { 
      type: 'heading', 
      level: headingMatch[1].length, 
      content: headingMatch[2] 
    };
  }
  
  // Check for unordered list
  const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
  if (ulMatch) {
    const indent = Math.floor(ulMatch[1].length / 2);
    return { 
      type: 'list-item', 
      ordered: false, 
      indent, 
      content: ulMatch[3] 
    };
  }
  
  // Check for ordered list
  const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (olMatch) {
    const indent = Math.floor(olMatch[1].length / 2);
    return { 
      type: 'list-item', 
      ordered: true, 
      number: parseInt(olMatch[2], 10),
      indent, 
      content: olMatch[3] 
    };
  }
  
  // Check for code block marker
  if (line.match(/^```/)) {
    return { type: 'code-block-marker', content: line.replace(/^```\w*/, '') };
  }
  
  // Regular paragraph
  return { type: 'paragraph', content: line, level: 0 };
}

/**
 * Wrap text with inline segments, returning wrapped lines with segment info.
 */
function wrapSegmentedText(doc, segments, maxWidth) {
  const lines = [];
  let currentLine = [];
  let currentWidth = 0;
  
  for (const segment of segments) {
    const words = segment.text.split(/(\s+)/);
    
    for (const word of words) {
      if (!word) continue;
      
      // Set font for measurement
      const fontStyle = segment.style === 'bold' ? 'bold' : 'normal';
      try {
        doc.setFont('DejaVu', fontStyle);
      } catch {
        doc.setFont('helvetica', fontStyle);
      }
      
      const wordWidth = doc.getTextWidth(word);
      
      if (currentWidth + wordWidth > maxWidth && currentLine.length > 0) {
        lines.push([...currentLine]);
        currentLine = [];
        currentWidth = 0;
      }
      
      // Skip leading whitespace on new line
      if (currentLine.length === 0 && word.match(/^\s+$/)) {
        continue;
      }
      
      currentLine.push({ text: word, style: segment.style });
      currentWidth += wordWidth;
    }
  }
  
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }
  
  return lines;
}

/**
 * Render a line with inline styled segments.
 */
function renderStyledLine(doc, segments, x, y, fonts) {
  let currentX = x;
  
  for (const segment of segments) {
    let fontStyle = 'normal';
    if (segment.style === 'bold') {
      fontStyle = 'bold';
    }
    
    if (fonts) {
      doc.setFont('DejaVu', fontStyle);
    } else {
      doc.setFont('helvetica', fontStyle);
    }
    
    // For code style, add a subtle background effect via gray text
    if (segment.style === 'code') {
      doc.setTextColor(80, 80, 80);
    }
    
    doc.text(segment.text, currentX, y);
    currentX += doc.getTextWidth(segment.text);
    
    // Reset color if it was changed
    if (segment.style === 'code') {
      doc.setTextColor(0, 0, 0);
    }
  }
  
  return currentX;
}

/**
 * Render markdown text to PDF with proper formatting.
 */
function renderMarkdownToPdf(doc, text, startY, config) {
  const { 
    marginLeft, 
    marginBottom, 
    pageHeight, 
    contentWidth, 
    lineHeight, 
    fonts,
    baseFontSize = 11
  } = config;
  
  if (!text) return startY;
  if (typeof text !== 'string') text = String(text);
  
  let y = startY;
  const paragraphs = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let inCodeBlock = false;
  let codeBlockLines = [];
  
  for (let i = 0; i < paragraphs.length; i++) {
    const rawLine = paragraphs[i];
    
    // Handle code blocks
    if (rawLine.match(/^```/)) {
      if (inCodeBlock) {
        // End code block - render accumulated code
        if (codeBlockLines.length > 0) {
          doc.setFontSize(9);
          doc.setTextColor(60, 60, 60);
          if (fonts) doc.setFont('DejaVu', 'normal');
          
          for (const codeLine of codeBlockLines) {
            if (y + lineHeight > pageHeight - marginBottom) {
              doc.addPage();
              y = 25;
            }
            doc.text(codeLine || ' ', marginLeft + 5, y);
            y += 5;
          }
          y += 3;
        }
        codeBlockLines = [];
        inCodeBlock = false;
        doc.setFontSize(baseFontSize);
        doc.setTextColor(0, 0, 0);
        continue;
      } else {
        inCodeBlock = true;
        continue;
      }
    }
    
    if (inCodeBlock) {
      codeBlockLines.push(rawLine);
      continue;
    }
    
    // Parse line type
    const parsed = parseLineType(rawLine);
    
    // Handle page break
    const neededHeight = parsed.type === 'heading' ? lineHeight * 1.5 : lineHeight;
    if (y + neededHeight > pageHeight - marginBottom) {
      doc.addPage();
      y = 25;
    }
    
    if (parsed.type === 'heading') {
      // Render heading with larger font and bold
      const headingSizes = { 1: 16, 2: 14, 3: 13, 4: 12, 5: 11, 6: 11 };
      const fontSize = headingSizes[parsed.level] || 11;
      
      doc.setFontSize(fontSize);
      doc.setTextColor(30, 58, 138);
      if (fonts) doc.setFont('DejaVu', 'bold');
      
      // Parse inline markdown in heading content
      const segments = parseInlineMarkdown(parsed.content);
      const wrappedLines = wrapSegmentedText(doc, segments, contentWidth);
      
      for (const lineSegments of wrappedLines) {
        if (y + lineHeight > pageHeight - marginBottom) {
          doc.addPage();
          y = 25;
        }
        // For headings, render all as bold
        const plainText = lineSegments.map(s => s.text).join('');
        doc.text(plainText, marginLeft, y);
        y += lineHeight * 1.2;
      }
      
      // Reset styles
      doc.setFontSize(baseFontSize);
      doc.setTextColor(0, 0, 0);
      if (fonts) doc.setFont('DejaVu', 'normal');
      y += 2;
      
    } else if (parsed.type === 'list-item') {
      // Render list item with bullet/number and indentation
      const indentX = marginLeft + (parsed.indent * 8);
      const bulletWidth = 10;
      
      doc.setFontSize(baseFontSize);
      doc.setTextColor(0, 0, 0);
      if (fonts) doc.setFont('DejaVu', 'normal');
      
      // Draw bullet or number
      if (parsed.ordered) {
        doc.text(`${parsed.number}.`, indentX, y);
      } else {
        doc.text('•', indentX, y);
      }
      
      // Parse and render content with inline styles
      const segments = parseInlineMarkdown(parsed.content);
      const itemWidth = contentWidth - (parsed.indent * 8) - bulletWidth;
      const wrappedLines = wrapSegmentedText(doc, segments, itemWidth);
      
      for (let j = 0; j < wrappedLines.length; j++) {
        if (y + lineHeight > pageHeight - marginBottom) {
          doc.addPage();
          y = 25;
        }
        renderStyledLine(doc, wrappedLines[j], indentX + bulletWidth, y, fonts);
        y += lineHeight;
      }
      
    } else {
      // Regular paragraph
      if (!rawLine.trim()) {
        y += lineHeight * 0.5;
        continue;
      }
      
      doc.setFontSize(baseFontSize);
      doc.setTextColor(0, 0, 0);
      if (fonts) doc.setFont('DejaVu', 'normal');
      
      const segments = parseInlineMarkdown(rawLine);
      const wrappedLines = wrapSegmentedText(doc, segments, contentWidth);
      
      for (const lineSegments of wrappedLines) {
        if (y + lineHeight > pageHeight - marginBottom) {
          doc.addPage();
          y = 25;
        }
        renderStyledLine(doc, lineSegments, marginLeft, y, fonts);
        y += lineHeight;
      }
    }
  }
  
  return y;
}

/**
 * Helper to fetch image and convert to Base64 for jsPDF.
 */
async function getImageData(url) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('Failed to load image:', url, e);
    return null;
  }
}

/**
 * Export council response to PDF with Cyrillic support.
 */
export async function exportCouncilToPdf(userQuestion, assistantMessage, t) {
  // Load fonts and logo in parallel
  const baseUrl = import.meta.env.BASE_URL || '/';
  const [fonts, logoData] = await Promise.all([
    loadFonts(),
    getImageData(`${baseUrl}council_logo_white.png`)
  ]);
  
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
  
  // Logo and Title
  let titleX = marginLeft;
  if (logoData) {
    const logoWidth = 20;
    const logoHeight = 20;
    doc.addImage(logoData, 'PNG', marginLeft, y - 12, logoWidth, logoHeight);
    titleX += logoWidth + 6;
  }

  doc.setFontSize(22);
  if (fonts) doc.setFont('DejaVu', 'bold');
  doc.setTextColor(30, 58, 138);
  doc.text('Arteus Council', titleX, y);
  y += 12;

  // Date
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  if (fonts) doc.setFont('DejaVu', 'normal');
  const now = new Date();
  doc.text(now.toLocaleString(), marginLeft, y);
  y += 14;

  // Shared config for markdown rendering
  const mdConfig = {
    marginLeft,
    marginBottom,
    pageHeight,
    contentWidth,
    lineHeight,
    fonts,
    baseFontSize: 11
  };

  // Question section
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  if (fonts) doc.setFont('DejaVu', 'bold');
  doc.text(t('youLabel') + ':', marginLeft, y);
  y += 8;

  doc.setTextColor(50, 50, 50);
  y = renderMarkdownToPdf(doc, userQuestion, y, mdConfig);
  y += 10;

  // Final Answer section
  if (assistantMessage.stage3) {
    doc.setFontSize(13);
    doc.setTextColor(30, 58, 138);
    if (fonts) doc.setFont('DejaVu', 'bold');
    const chairmanName = assistantMessage.stage3.model?.split('/')[1] || assistantMessage.stage3.model || 'Chairman';
    doc.text(`${t('stage3Title')} (${chairmanName}):`, marginLeft, y);
    y += 8;

    doc.setTextColor(0, 0, 0);
    y = renderMarkdownToPdf(doc, assistantMessage.stage3.response, y, mdConfig);
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

    const stage1MdConfig = { ...mdConfig, baseFontSize: 10, lineHeight: 5 };
    
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

      doc.setTextColor(0, 0, 0);
      const responseText = typeof response === 'string' ? response : String(response || '');
      y = renderMarkdownToPdf(doc, responseText, y, stage1MdConfig);
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
      .filter(([, data]) => data && typeof data.average === 'number')
      .sort((a, b) => a[1].average - b[1].average);

    for (const [model, data] of sortedModels) {
      if (y > pageHeight - marginBottom) {
        doc.addPage();
        y = 25;
      }
      const modelName = model.split('/')[1] || model;
      const avg = typeof data.average === 'number' ? data.average.toFixed(2) : 'N/A';
      const votes = data.votes ?? 0;
      const avgText = `${t('avgShort')}: ${avg}, ${t('votes')}: ${votes}`;
      doc.text(`${modelName} - ${avgText}`, marginLeft, y);
      y += 7;
    }
  }

  // Save PDF
  const timestamp = now.toISOString().slice(0, 19).replace(/[T:]/g, '-');
  doc.save(`arteus-council-${timestamp}.pdf`);
}
