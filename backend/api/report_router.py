import io
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from security import get_current_user
from rate_limiter import limiter
from db.storage import storage
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

logger = logging.getLogger("shield-report-pdf")

router = APIRouter(prefix="/api/v1/reports", tags=["Reporting"])

@router.post("/incident/{alert_id}/pdf")
@limiter.limit("5/minute")
async def generate_incident_pdf(
    request: Request,
    alert_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    REP-1 & REP-2:
    Generates a formal, tamper-evident PDF incident report with:
    - Incident summary and trigger type
    - Location trail and timestamps
    - Chained cryptographic evidence hashes (SHA-256)
    - Guardian acknowledgement timeline
    - Legal disclaimer stating it is user-generated and assistive
    """
    alert = await storage.get_alert_by_id(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    evidence_chunks = await storage.get_evidence_chunks(alert_id)
    trail = []
    if alert.get("walk_id"):
        trail = await storage.get_walk_trail(alert["walk_id"])

    user = await storage.get_user_by_id(str(current_user["user_id"]))
    user_name = user.get("name", "Walker") if user else "Walker"
    user_phone = user.get("phone_number", "Registered User") if user else "Registered User"

    # Build PDF with ReportLab
    pdf_buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        pdf_buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontSize=20,
        leading=24,
        textColor=colors.HexColor('#B71C1C'),
        fontName='Helvetica-Bold'
    )
    subtitle_style = ParagraphStyle(
        'Subtitle',
        parent=styles['Normal'],
        fontSize=10,
        leading=14,
        textColor=colors.HexColor('#555555')
    )
    h2_style = ParagraphStyle(
        'H2',
        parent=styles['Heading2'],
        fontSize=13,
        leading=17,
        textColor=colors.HexColor('#1E1E1E'),
        fontName='Helvetica-Bold',
        spaceBefore=10,
        spaceAfter=6
    )
    body_style = ParagraphStyle(
        'Body',
        parent=styles['Normal'],
        fontSize=9,
        leading=13,
        textColor=colors.HexColor('#222222')
    )
    disclaimer_style = ParagraphStyle(
        'Disclaimer',
        parent=styles['Normal'],
        fontSize=8,
        leading=11,
        textColor=colors.HexColor('#777777'),
        fontName='Helvetica-Oblique'
    )

    story = []

    # Title & Header
    story.append(Paragraph("SHIELD Walk: Official Incident Verification Report", title_style))
    story.append(Paragraph(f"Generated on {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')} | Document ID: INC-{alert_id[:8].upper()}", subtitle_style))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor('#B71C1C'), spaceAfter=12))

    # Summary Table
    summary_data = [
        ["Alert Identifier", alert_id],
        ["Trigger Type", alert.get("trigger_type", "SOS_BUTTON")],
        ["Current State", alert.get("state", "RESOLVED")],
        ["Trigger Coordinates", f"Lat {alert.get('lat', 0.0):.6f}, Lon {alert.get('lon', 0.0):.6f}"],
        ["Timestamp Initiated", alert.get("started_at", "N/A")],
        ["Timestamp Resolved", alert.get("resolved_at") or "Active / Escalated"],
        ["User Contact", f"{user_name} ({user_phone})"],
    ]

    t_summary = Table(summary_data, colWidths=[150, 390])
    t_summary.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#F5F5F5')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#222222')),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#DDDDDD')),
    ]))
    story.append(t_summary)
    story.append(Spacer(1, 14))

    # State Machine Timeline
    story.append(Paragraph("1. Incident Timeline & Escalation Log", h2_style))
    events = alert.get("events", [])
    if events:
        event_rows = [["Timestamp", "Event Action", "Actor / Responsible Entity"]]
        for e in events:
            event_rows.append([
                e.get("ts", "")[:19],
                e.get("event_type", ""),
                e.get("actor", "system")
            ])
        t_events = Table(event_rows, colWidths=[140, 150, 250])
        t_events.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1E1E1E')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#FAFAFA')]),
            ('PADDING', (0, 0), (-1, -1), 4),
        ]))
        story.append(t_events)
    else:
        story.append(Paragraph("Initial trigger recorded. No intermediate state transitions logged.", body_style))

    story.append(Spacer(1, 14))

    # Cryptographic Evidence Chain (EVID-4)
    story.append(Paragraph("2. Cryptographic Evidence Chain (Tamper-Evident SHA-256 Hashes)", h2_style))
    if evidence_chunks:
        chunk_rows = [["Chunk", "Previous Hash (prev_sha256)", "Chunk Hash (sha256)"]]
        for c in evidence_chunks:
            chunk_rows.append([
                f"#{c.get('seq')}",
                c.get("prev_sha256", "")[:24] + "...",
                c.get("sha256", "")[:24] + "..."
            ])
        t_chunks = Table(chunk_rows, colWidths=[50, 245, 245])
        t_chunks.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2E7D32')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
            ('PADDING', (0, 0), (-1, -1), 4),
        ]))
        story.append(t_chunks)
    else:
        story.append(Paragraph("Audio evidence captured and encrypted locally; chunk metadata pending cellular sync.", body_style))

    story.append(Spacer(1, 14))

    # GPS Trail Snapshot
    story.append(Paragraph("3. GPS Location Trail Preceding Alert", h2_style))
    if trail:
        trail_summary = f"Recorded {len(trail)} GPS waypoints during walk. Latest coordinates: {trail[-1].get('lat', 0.0):.6f}, {trail[-1].get('lon', 0.0):.6f} (Speed: {trail[-1].get('speed', 0.0)} m/s, Accuracy: {trail[-1].get('accuracy', 0.0)}m)."
        story.append(Paragraph(trail_summary, body_style))
    else:
        story.append(Paragraph(f"Single point fix registered at trigger: Lat {alert.get('lat', 0.0):.6f}, Lon {alert.get('lon', 0.0):.6f}.", body_style))

    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#CCCCCC'), spaceAfter=8))

    # Mandatory Legal Disclaimer (REP-2, LEG-3)
    disclaimer_text = (
        "<b>LEGAL & COMPLIANCE NOTICE (SRS REP-2, LEG-3):</b> This document is generated at the request of the user "
        "as a private record of an assistive safety event. SHIELD Walk is an assistive personal safety tool and is "
        "not a replacement for emergency police services (112) or law enforcement dispatch. Neither SHIELD Walk "
        "nor its developers guarantee emergency response times or outcome. All cryptographic evidence hashes represent "
        "AES-256-GCM ciphertext sealed on the device."
    )
    story.append(Paragraph(disclaimer_text, disclaimer_style))

    doc.build(story)
    pdf_buffer.seek(0)
    pdf_bytes = pdf_buffer.getvalue()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=shield_incident_{alert_id[:8]}.pdf"}
    )
