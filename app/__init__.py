import os
import shutil
from pathlib import Path

from flask import Flask, jsonify, request
from flask_wtf import CSRFProtect
from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash

from .extensions import db, login_manager
from .models import AdminUser, Filter, SiteSetting
from .routes import public_bp, admin_bp
from .utils import ensure_dirs, cleanup_expired

csrf = CSRFProtect()


def _database_url() -> str:
    """Return a SQLAlchemy URL compatible with the installed PostgreSQL driver.

    Railway exposes PostgreSQL URLs as postgres:// or postgresql://. SQLAlchemy's
    plain postgresql:// URL defaults to psycopg2, while this project intentionally
    uses psycopg v3 (psycopg[binary]). Force the explicit +psycopg dialect so a
    deploy never depends on an uninstalled psycopg2 package.
    """
    url = (os.getenv("DATABASE_URL") or "").strip()
    if not url:
        return "sqlite:////tmp/duso_43123.db"

    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    if url.startswith("postgresql+psycopg2://"):
        return "postgresql+psycopg://" + url[len("postgresql+psycopg2://"):]
    return url


def _data_dir() -> str:
    configured = (os.getenv("DATA_DIR") or "").strip()
    if configured:
        return configured

    # Railway volumes for this project are mounted at /data. Keep local
    # development self-contained when Railway-specific variables are absent.
    if any(key.startswith("RAILWAY_") for key in os.environ):
        return "/data"
    return str(Path(__file__).resolve().parent.parent / "data")


def create_app():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.getenv("SECRET_KEY") or "dev-change-me",
        SQLALCHEMY_DATABASE_URI=_database_url(),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SQLALCHEMY_ENGINE_OPTIONS={
            "pool_pre_ping": True,
            "pool_recycle": 280,
        },
        MAX_CONTENT_LENGTH=int(os.getenv("MAX_UPLOAD_MB", "15")) * 1024 * 1024,
        DATA_DIR=_data_dir(),
        RETENTION_DAYS=int(os.getenv("RETENTION_DAYS", "30")),
        SITE_NAME=os.getenv("SITE_NAME", "Duso 43123"),
    )

    db.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = "admin.login"
    login_manager.login_message = "Faça login para acessar o painel."
    login_manager.login_message_category = "warning"
    csrf.init_app(app)

    # Public editor APIs run inside an iframe on the campaign WordPress domain.
    # Browsers may block third-party session cookies in that context, which makes
    # Flask-WTF CSRF validation fail before the API can return JSON. The public
    # endpoints already use per-submission access tokens for sensitive actions,
    # so keep CSRF protection on the admin blueprint and exempt only public_bp.
    csrf.exempt(public_bp)

    app.register_blueprint(public_bp)
    app.register_blueprint(admin_bp, url_prefix="/admin")

    @app.context_processor
    def inject_site_layout():
        setting = SiteSetting.query.first()
        width = setting.content_width if setting else 1080
        return {"site_content_width": max(760, min(1400, int(width)))}

    @app.errorhandler(413)
    def too_large(_error):
        if request.path.startswith("/api/"):
            max_mb = int(app.config["MAX_CONTENT_LENGTH"] / 1024 / 1024)
            return jsonify(error=f"A imagem ultrapassa o limite de {max_mb} MB."), 413
        return "Arquivo grande demais.", 413

    with app.app_context():
        ensure_dirs(app)
        db.create_all()
        _bootstrap(app)
        cleanup_expired(app)

    return app


def _bootstrap(app):
    """Create defaults and migrate any previous campaign to Duso safely."""
    email = os.getenv("ADMIN_EMAIL", "admin@campanha.com.br").strip().lower()
    password = os.getenv("ADMIN_PASSWORD", "admin43123")

    if not AdminUser.query.filter_by(email=email).first():
        try:
            db.session.add(AdminUser(name="Administrador", email=email,
                                     password_hash=generate_password_hash(password)))
            db.session.commit()
        except IntegrityError:
            db.session.rollback()

    if not SiteSetting.query.first():
        try:
            db.session.add(SiteSetting(content_width=1080))
            db.session.commit()
        except IntegrityError:
            db.session.rollback()

    root = Path(__file__).resolve().parent.parent
    seed = root / "seed_assets"
    target = Path(app.config["DATA_DIR"]) / "filters"
    site_target = Path(app.config["DATA_DIR"]) / "site"
    target.mkdir(parents=True, exist_ok=True)
    site_target.mkdir(parents=True, exist_ok=True)

    overlay = target / "moldura-duso-43123.png"
    example = target / "exemplo-duso-43123.png"
    if (seed / "moldura-duso-43123.png").exists():
        shutil.copy2(seed / "moldura-duso-43123.png", overlay)
    if (seed / "exemplo-duso-43123.png").exists():
        shutil.copy2(seed / "exemplo-duso-43123.png", example)
    featured = Filter.query.filter_by(is_featured=True).first()
    migrating_previous_campaign = bool(featured and featured.slug != "duso-43123")

    # Keep a logo uploaded later by the administrator, but replace the logo when
    # this package is first deployed over a previous campaign volume.
    footer_logo = site_target / "footer-logo.png"
    if (not footer_logo.exists() or migrating_previous_campaign) and (seed / "logo-duso.png").exists():
        shutil.copy2(seed / "logo-duso.png", footer_logo)

    # Convert the currently featured campaign so a reused database/volume does
    # not keep public information from the previous project.

    if featured:
        featured.name = "Duso 43123"
        featured.slug = "duso-43123"
        featured.headline = "Faça parte da mudança"
        featured.subheadline = "Mostre seu apoio com sua foto — envie uma imagem ou use a câmera frontal com o óculos Duso."
        featured.overlay_file = overlay.name
        featured.example_file = example.name
        featured.primary_color = "#11312A"
        featured.accent_color = "#DFFF01"
        featured.is_active = True
        featured.is_featured = True
        for other in Filter.query.filter(Filter.id != featured.id).all():
            other.is_featured = False
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
    elif Filter.query.count() == 0:
        try:
            db.session.add(Filter(
                name="Duso 43123", slug="duso-43123",
                headline="Faça parte da mudança",
                subheadline="Mostre seu apoio com sua foto — envie uma imagem ou use a câmera frontal com o óculos Duso.",
                overlay_file=overlay.name, example_file=example.name,
                is_active=True, is_featured=True,
                primary_color="#11312A", accent_color="#DFFF01",
            ))
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
