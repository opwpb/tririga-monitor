"""
docx_exporter.py
Generates polished, executive-ready Word (.docx) documents from Markdown reports.
Includes custom typography, headers, footers, callout boxes, zebra-striped tables,
code blocks, and formatted lists.
"""

import re
import io
from typing import List, Tuple, Optional
try:
    import docx
    from docx.shared import Inches, Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
    from docx.oxml import OxmlElement, parse_xml
    from docx.oxml.ns import nsdecls, qn
    DOCX_AVAILABLE = True
except ImportError:
    docx = None
    DOCX_AVAILABLE = False
    class _Dummy:
        def __init__(self, *args, **kwargs): pass
    Pt = Inches = RGBColor = OxmlElement = _Dummy
    parse_xml = lambda s: None
    WD_ALIGN_PARAGRAPH = WD_TABLE_ALIGNMENT = WD_ALIGN_VERTICAL = _Dummy
    nsdecls = qn = lambda s: s

def _set_cell_background(cell, hex_color: str):
    """Sets background color of a table cell (e.g. '1E293B' or 'F8FAFC')."""
    shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color.lstrip("#")}"/>')
    cell._tc.get_or_add_tcPr().append(shading)

def _set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    """Sets internal padding (in twips/dxa) for a table cell."""
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = OxmlElement('w:tcMar')
    for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        node = OxmlElement(f'w:{m}')
        node.set(qn('w:w'), str(val))
        node.set(qn('w:type'), 'dxa')
        tcMar.append(node)
    tcPr.append(tcMar)

def _set_cell_left_border(cell, hex_color="0284C7", size="36"):
    """Adds a thick colored left border to a cell for blockquotes/callouts."""
    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = parse_xml(
        f'<w:tcBorders {nsdecls("w")}>'
        f'  <w:top w:val="none"/>'
        f'  <w:left w:val="single" w:sz="{size}" w:space="0" w:color="{hex_color.lstrip("#")}"/>'
        f'  <w:bottom w:val="none"/>'
        f'  <w:right w:val="none"/>'
        f'</w:tcBorders>'
    )
    tcPr.append(tcBorders)

def _set_table_borders(table, border_color="CBD5E1"):
    """Sets subtle light-grey borders on a data table."""
    tblPr = table._tbl.tblPr
    borders = parse_xml(
        f'<w:tblBorders {nsdecls("w")}>'
        f'  <w:top w:val="single" w:sz="4" w:space="0" w:color="{border_color}"/>'
        f'  <w:bottom w:val="single" w:sz="8" w:space="0" w:color="{border_color}"/>'
        f'  <w:insideH w:val="single" w:sz="4" w:space="0" w:color="{border_color}"/>'
        f'  <w:insideV w:val="none"/>'
        f'  <w:left w:val="none"/>'
        f'  <w:right w:val="none"/>'
        f'</w:tblBorders>'
    )
    tblPr.append(borders)

def add_formatted_text_runs(paragraph, text: str, default_color: RGBColor = RGBColor(0x1F, 0x29, 0x37), font_size: Pt = Pt(10.5)):
    """Parses markdown bold, italic, inline code, and links into Word formatting runs."""
    pattern = re.compile(
        r'(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[([^\]]+)\]\(([^)]+)\))'
    )
    pos = 0
    for match in pattern.finditer(text):
        start, end = match.span()
        if start > pos:
            run = paragraph.add_run(text[pos:start])
            run.font.name = 'Calibri'
            run.font.size = font_size
            run.font.color.rgb = default_color
        
        token = match.group(0)
        if token.startswith('***') and token.endswith('***'):
            inner = token[3:-3]
            run = paragraph.add_run(inner)
            run.bold = True
            run.italic = True
            run.font.name = 'Calibri'
            run.font.size = font_size
            run.font.color.rgb = default_color
        elif token.startswith('**') and token.endswith('**'):
            inner = token[2:-2]
            run = paragraph.add_run(inner)
            run.bold = True
            run.font.name = 'Calibri'
            run.font.size = font_size
            run.font.color.rgb = RGBColor(0x0F, 0x17, 0x2A)
        elif token.startswith('*') and token.endswith('*'):
            inner = token[1:-1]
            run = paragraph.add_run(inner)
            run.italic = True
            run.font.name = 'Calibri'
            run.font.size = font_size
            run.font.color.rgb = default_color
        elif token.startswith('`') and token.endswith('`'):
            inner = token[1:-1]
            run = paragraph.add_run(inner)
            run.font.name = 'Consolas'
            run.font.size = Pt(font_size.pt - 1.0)
            run.font.color.rgb = RGBColor(0xBE, 0x18, 0x5D)
        elif token.startswith('[') and '](' in token:
            link_text = match.group(2)
            run = paragraph.add_run(link_text)
            run.font.name = 'Calibri'
            run.font.size = font_size
            run.font.color.rgb = RGBColor(0x02, 0x84, 0xC7)
            run.underline = True
        
        pos = end

    if pos < len(text):
        run = paragraph.add_run(text[pos:])
        run.font.name = 'Calibri'
        run.font.size = font_size
        run.font.color.rgb = default_color

class DocxReportExporter:
    """Transforms Markdown Technical Audit Reports into styled Word (.docx) files."""

    @classmethod
    def generate_docx(cls, markdown_content: str, title: str = "IBM TRIRIGA Log Audit Report") -> io.BytesIO:
        doc = docx.Document()

        for section in doc.sections:
            section.top_margin = Inches(1.0)
            section.bottom_margin = Inches(1.0)
            section.left_margin = Inches(1.0)
            section.right_margin = Inches(1.0)
            
            is_chat = any(k in title.lower() for k in ("chat", "conversation", "transcript", "assistant"))

            header = section.header
            header_p = header.paragraphs[0]
            header_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            header_txt = "IBM TRIRIGA AI Assistant • Consultation Transcript" if is_chat else "IBM TRIRIGA Enterprise Diagnostic Audit • Confidential"
            hrun = header_p.add_run(header_txt)
            hrun.font.name = 'Calibri'
            hrun.font.size = Pt(8.5)
            hrun.font.color.rgb = RGBColor(0x94, 0xA3, 0xB8)
            
            footer = section.footer
            footer_p = footer.paragraphs[0]
            footer_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            footer_txt = "Automated AI Chat Consultation • TRIRIGA Log Analysis & Forensics" if is_chat else "Automated AI Diagnostic Report • TRIRIGA Production Nodes (prod app1 & prod app2)"
            frun = footer_p.add_run(footer_txt)
            frun.font.name = 'Calibri'
            frun.font.size = Pt(8.5)
            frun.font.color.rgb = RGBColor(0x94, 0xA3, 0xB8)

        normal_style = doc.styles['Normal']
        normal_style.font.name = 'Calibri'
        normal_style.font.size = Pt(10.5)
        normal_style.font.color.rgb = RGBColor(0x1F, 0x29, 0x37)

        lines = markdown_content.splitlines()
        i = 0
        n = len(lines)

        while i < n:
            raw_line = lines[i]
            line = raw_line.strip()

            if not line:
                i += 1
                continue

            # 1. Code Block (```lang ... ```)
            if line.startswith('```'):
                code_lines = []
                i += 1
                while i < n and not lines[i].strip().startswith('```'):
                    code_lines.append(lines[i])
                    i += 1
                i += 1
                
                code_text = "\n".join(code_lines)
                tbl = doc.add_table(rows=1, cols=1)
                tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
                cell = tbl.cell(0, 0)
                cell.width = Inches(6.5)
                _set_cell_background(cell, "F1F5F9")
                _set_cell_margins(cell, top=120, bottom=120, left=180, right=180)
                
                cp = cell.paragraphs[0]
                cp.paragraph_format.space_before = Pt(2)
                cp.paragraph_format.space_after = Pt(2)
                cp.paragraph_format.line_spacing = 1.15
                crun = cp.add_run(code_text)
                crun.font.name = 'Consolas'
                crun.font.size = Pt(9.0)
                crun.font.color.rgb = RGBColor(0x0F, 0x17, 0x2A)
                
                sp_p = doc.add_paragraph()
                sp_p.paragraph_format.space_before = Pt(0)
                sp_p.paragraph_format.space_after = Pt(4)
                continue

            # 2. Blockquote / Callout (> [!NOTE] or > text)
            if line.startswith('>'):
                quote_lines = []
                while i < n and lines[i].strip().startswith('>'):
                    cleaned_q = re.sub(r'^>\s?', '', lines[i].strip())
                    if cleaned_q:
                        quote_lines.append(cleaned_q)
                    i += 1
                
                q_text = " ".join(quote_lines)
                border_color = "0284C7"
                bg_color = "F0F9FF"
                if "WARNING" in q_text.upper() or "CAUTION" in q_text.upper():
                    border_color = "E11D48"
                    bg_color = "FFF1F2"
                elif "NOTE" in q_text.upper() or "TIP" in q_text.upper():
                    border_color = "0284C7"
                    bg_color = "F0F9FF"
                
                clean_msg = re.sub(r'\[!(NOTE|WARNING|IMPORTANT|TIP|CAUTION)\]\s*', '', q_text)
                
                tbl = doc.add_table(rows=1, cols=1)
                tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
                cell = tbl.cell(0, 0)
                cell.width = Inches(6.5)
                _set_cell_background(cell, bg_color)
                _set_cell_left_border(cell, hex_color=border_color, size="32")
                _set_cell_margins(cell, top=120, bottom=120, left=180, right=150)
                
                qp = cell.paragraphs[0]
                qp.paragraph_format.space_before = Pt(2)
                qp.paragraph_format.space_after = Pt(2)
                qp.paragraph_format.line_spacing = 1.15
                add_formatted_text_runs(qp, clean_msg, default_color=RGBColor(0x0F, 0x17, 0x2A), font_size=Pt(10.0))
                
                sp_p = doc.add_paragraph()
                sp_p.paragraph_format.space_before = Pt(0)
                sp_p.paragraph_format.space_after = Pt(4)
                continue

            # 3. Markdown Table (| Col 1 | Col 2 |)
            if line.startswith('|') and '|' in line[1:]:
                table_lines = []
                while i < n and lines[i].strip().startswith('|'):
                    table_lines.append(lines[i].strip())
                    i += 1
                
                parsed_rows = []
                for tl in table_lines:
                    if re.match(r'^\|[\s\-:|]+\|$', tl):
                        continue
                    cells = [c.strip() for c in tl.split('|')[1:-1]]
                    if cells:
                        parsed_rows.append(cells)
                
                if parsed_rows:
                    num_cols = max(len(r) for r in parsed_rows)
                    tbl = doc.add_table(rows=len(parsed_rows), cols=num_cols)
                    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
                    _set_table_borders(tbl, border_color="CBD5E1")
                    
                    for row_idx, r_data in enumerate(parsed_rows):
                        row = tbl.rows[row_idx]
                        is_header = (row_idx == 0)
                        for col_idx in range(num_cols):
                            cell_val = r_data[col_idx] if col_idx < len(r_data) else ""
                            cell = row.cells[col_idx]
                            _set_cell_margins(cell, top=80, bottom=80, left=100, right=100)
                            
                            if is_header:
                                _set_cell_background(cell, "1E293B")
                                p = cell.paragraphs[0]
                                p.paragraph_format.space_before = Pt(2)
                                p.paragraph_format.space_after = Pt(2)
                                run = p.add_run(cell_val)
                                run.font.name = 'Calibri'
                                run.font.size = Pt(9.5)
                                run.bold = True
                                run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
                            else:
                                bg = "F8FAFC" if row_idx % 2 == 1 else "FFFFFF"
                                _set_cell_background(cell, bg)
                                p = cell.paragraphs[0]
                                p.paragraph_format.space_before = Pt(2)
                                p.paragraph_format.space_after = Pt(2)
                                add_formatted_text_runs(p, cell_val, default_color=RGBColor(0x1E, 0x29, 0x3B), font_size=Pt(9.5))
                    
                    sp_p = doc.add_paragraph()
                    sp_p.paragraph_format.space_before = Pt(0)
                    sp_p.paragraph_format.space_after = Pt(6)
                continue

            # 4. Horizontal Rule (--- or ***)
            if re.match(r'^(\-{3,}|\*{3,}|_{3,})$', line):
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(6)
                p.paragraph_format.space_after = Pt(6)
                pPr = p._p.get_or_add_pPr()
                pBdr = parse_xml(f'<w:pBdr {nsdecls("w")}><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CBD5E1"/></w:pBdr>')
                pPr.append(pBdr)
                i += 1
                continue

            # 5. Heading 1 (# ...)
            if line.startswith('# '):
                heading_text = line[2:].strip()
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(14)
                p.paragraph_format.space_after = Pt(6)
                p.paragraph_format.keep_with_next = True
                run = p.add_run(heading_text)
                run.font.name = 'Segoe UI'
                run.font.size = Pt(18)
                run.bold = True
                run.font.color.rgb = RGBColor(0x0F, 0x29, 0x42)
                i += 1
                continue

            # 6. Heading 2 (## ...)
            if line.startswith('## '):
                heading_text = line[3:].strip()
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(14)
                p.paragraph_format.space_after = Pt(4)
                p.paragraph_format.keep_with_next = True
                run = p.add_run(heading_text)
                run.font.name = 'Segoe UI'
                run.font.size = Pt(13.5)
                run.bold = True
                run.font.color.rgb = RGBColor(0x0F, 0x4C, 0x81)
                i += 1
                continue

            # 7. Heading 3 (### ...)
            if line.startswith('### '):
                heading_text = line[4:].strip()
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(10)
                p.paragraph_format.space_after = Pt(3)
                p.paragraph_format.keep_with_next = True
                run = p.add_run(heading_text)
                run.font.name = 'Segoe UI'
                run.font.size = Pt(11.5)
                run.bold = True
                run.font.color.rgb = RGBColor(0x03, 0x69, 0xA1)
                i += 1
                continue

            # 8. Heading 4 (#### ...)
            if line.startswith('#### '):
                heading_text = line[5:].strip()
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(8)
                p.paragraph_format.space_after = Pt(2)
                p.paragraph_format.keep_with_next = True
                run = p.add_run(heading_text)
                run.font.name = 'Segoe UI'
                run.font.size = Pt(10.5)
                run.bold = True
                run.font.color.rgb = RGBColor(0x33, 0x41, 0x55)
                i += 1
                continue

            # 9. Bullet Point (- or * )
            if re.match(r'^[-*+]\s+', line):
                bullet_text = re.sub(r'^[-*+]\s+', '', line)
                p = doc.add_paragraph(style='List Bullet')
                p.paragraph_format.space_before = Pt(1.5)
                p.paragraph_format.space_after = Pt(1.5)
                p.paragraph_format.line_spacing = 1.15
                add_formatted_text_runs(p, bullet_text, default_color=RGBColor(0x1F, 0x29, 0x37), font_size=Pt(10.0))
                i += 1
                continue

            # 10. Numbered List (1. ...)
            if re.match(r'^\d+\.\s+', line):
                num_text = re.sub(r'^\d+\.\s+', '', line)
                p = doc.add_paragraph(style='List Number')
                p.paragraph_format.space_before = Pt(1.5)
                p.paragraph_format.space_after = Pt(1.5)
                p.paragraph_format.line_spacing = 1.15
                add_formatted_text_runs(p, num_text, default_color=RGBColor(0x1F, 0x29, 0x37), font_size=Pt(10.0))
                i += 1
                continue

            # 11. Standard Paragraph
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(3)
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.line_spacing = 1.18
            add_formatted_text_runs(p, line, default_color=RGBColor(0x1F, 0x29, 0x37), font_size=Pt(10.5))
            i += 1

        output_stream = io.BytesIO()
        doc.save(output_stream)
        output_stream.seek(0)
        return output_stream