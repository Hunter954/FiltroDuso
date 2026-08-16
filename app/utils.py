import hashlib, os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from PIL import Image, ImageOps
from flask import request
from .extensions import db
from .models import Submission

ALLOWED = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


def ensure_dirs(app):
    base = Path(app.config["DATA_DIR"])
    for x in ("filters", "uploads", "rendered", "site"):
        (base / x).mkdir(parents=True, exist_ok=True)


def client_ip_hash(secret):
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    return hashlib.sha256(f"{secret}:{ip}".encode()).hexdigest()


def validate_and_normalize(src_path, dst_path):
    with Image.open(src_path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        if max(im.size) > 5000:
            im.thumbnail((5000, 5000), Image.Resampling.LANCZOS)
        im.save(dst_path, "JPEG", quality=90, optimize=False)


def render_submission_image(app, submission, transform, out_path):
    base = Path(app.config["DATA_DIR"])
    original_path = base / "uploads" / submission.original_file
    overlay_path = base / "filters" / submission.filter.overlay_file
    if not original_path.exists() or not overlay_path.exists():
        raise FileNotFoundError("Arquivos necessários não encontrados")

    scale = float(transform.get("scale", 1))
    x = float(transform.get("x", 0))
    y = float(transform.get("y", 0))
    if scale <= 0:
        raise ValueError("Scale inválido")

    with Image.open(original_path) as source:
        source = ImageOps.exif_transpose(source).convert("RGB")
        canvas = Image.new("RGB", (1080, 1080), "white")
        new_w = max(1, round(source.width * scale))
        new_h = max(1, round(source.height * scale))
        resized = source.resize((new_w, new_h), Image.Resampling.LANCZOS)
        canvas.paste(resized, (round(x), round(y)))

    with Image.open(overlay_path) as overlay:
        overlay = overlay.convert("RGBA")
        if overlay.size != (1080, 1080):
            overlay = overlay.resize((1080, 1080), Image.Resampling.LANCZOS)
        output = canvas.convert("RGBA")
        output.alpha_composite(overlay)
        output.save(out_path, "PNG", optimize=False, compress_level=3)


def cleanup_expired(app):
    days = app.config.get("RETENTION_DAYS", 30)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = Submission.query.filter(Submission.created_at < cutoff, Submission.deleted_at.is_(None)).limit(250).all()
    base = Path(app.config["DATA_DIR"])
    changed = False
    for s in rows:
        for folder, name in (("uploads", s.original_file), ("rendered", s.rendered_file)):
            if name:
                p = base / folder / name
                try:
                    p.unlink(missing_ok=True)
                except Exception:
                    pass
        s.deleted_at = datetime.now(timezone.utc)
        changed = True
    if changed:
        db.session.commit()
