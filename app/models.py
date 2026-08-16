from datetime import datetime, timezone
from flask_login import UserMixin
from .extensions import db, login_manager


def now(): return datetime.now(timezone.utc)

class AdminUser(UserMixin, db.Model):
    __tablename__ = "admin_users"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=now, nullable=False)
    last_login_at = db.Column(db.DateTime(timezone=True))

@login_manager.user_loader
def load_user(user_id):
    return db.session.get(AdminUser, int(user_id))


class SiteSetting(db.Model):
    __tablename__ = "site_settings"
    id = db.Column(db.Integer, primary_key=True)
    content_width = db.Column(db.Integer, nullable=False, default=1080)
    updated_at = db.Column(db.DateTime(timezone=True), default=now, onupdate=now, nullable=False)

class Filter(db.Model):
    __tablename__ = "filters"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    slug = db.Column(db.String(180), unique=True, nullable=False, index=True)
    headline = db.Column(db.String(180), nullable=False, default="Mostre seu apoio")
    subheadline = db.Column(db.Text, nullable=False, default="Envie sua foto, ajuste e baixe pronta.")
    overlay_file = db.Column(db.String(255), nullable=False)
    example_file = db.Column(db.String(255))
    primary_color = db.Column(db.String(16), default="#11312A")
    accent_color = db.Column(db.String(16), default="#DFFF01")
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    is_featured = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=now, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=now, onupdate=now, nullable=False)
    submissions = db.relationship("Submission", backref="filter", lazy=True)

class Submission(db.Model):
    __tablename__ = "submissions"
    id = db.Column(db.String(36), primary_key=True)
    filter_id = db.Column(db.Integer, db.ForeignKey("filters.id"), nullable=False, index=True)
    access_token = db.Column(db.String(64), nullable=False, index=True)
    original_file = db.Column(db.String(255), nullable=False)
    rendered_file = db.Column(db.String(255))
    original_name = db.Column(db.String(255))
    mime_type = db.Column(db.String(80))
    size_bytes = db.Column(db.Integer)
    ip_hash = db.Column(db.String(64), index=True)
    user_agent = db.Column(db.String(500))
    consent_at = db.Column(db.DateTime(timezone=True), nullable=False, default=now)
    created_at = db.Column(db.DateTime(timezone=True), default=now, nullable=False, index=True)
    completed_at = db.Column(db.DateTime(timezone=True))
    downloaded_at = db.Column(db.DateTime(timezone=True))
    deleted_at = db.Column(db.DateTime(timezone=True))

class Event(db.Model):
    __tablename__ = "events"
    id = db.Column(db.Integer, primary_key=True)
    filter_id = db.Column(db.Integer, db.ForeignKey("filters.id"), nullable=True, index=True)
    submission_id = db.Column(db.String(36), nullable=True, index=True)
    event_type = db.Column(db.String(40), nullable=False, index=True)
    ip_hash = db.Column(db.String(64), index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=now, nullable=False, index=True)
