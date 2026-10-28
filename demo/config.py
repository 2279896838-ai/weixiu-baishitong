# -*- coding: utf-8 -*-
# Copyright (c) 2026 张庆涛（日照职业技术大学 智能冶金系 工业互联网）. All rights reserved.
"""集中配置与生产启动校验。

环境变量：
- WXBST_ENV=development|production
- WXBST_STORAGE=sqlite|jsonl
- WXBST_DB_PATH
- WXBST_AUTH_MODE=off|token
- WXBST_API_TOKENS="token:role,token:role"（role: viewer/student/teacher/admin）
- WXBST_TRUST_PROXY=1/0
- WXBST_HSTS=1/0
"""
import os
from dataclasses import dataclass, field


@dataclass
class Settings:
    env: str = "development"
    storage: str = "sqlite"
    db_path: str = ""
    auth_mode: str = "off"
    tokens: dict = field(default_factory=dict)
    trust_proxy: bool = True
    hsts: bool = False

    @classmethod
    def from_env(cls):
        raw_tokens = os.environ.get("WXBST_API_TOKENS", "")
        tokens = {}
        for chunk in raw_tokens.replace(";", ",").split(","):
            chunk = chunk.strip()
            if not chunk or ":" not in chunk:
                continue
            token, role = chunk.rsplit(":", 1)
            token = token.strip()
            role = role.strip().lower()
            if token and role in ("viewer", "student", "teacher", "admin"):
                tokens[token] = role
        return cls(
            env=(os.environ.get("WXBST_ENV") or "development").strip().lower(),
            storage=(os.environ.get("WXBST_STORAGE") or "sqlite").strip().lower(),
            db_path=os.environ.get("WXBST_DB_PATH", ""),
            auth_mode=(os.environ.get("WXBST_AUTH_MODE") or "off").strip().lower(),
            tokens=tokens,
            trust_proxy=(os.environ.get("WXBST_TRUST_PROXY", "1").strip() not in ("0", "false", "no")),
            hsts=(os.environ.get("WXBST_HSTS", "0").strip() in ("1", "true", "yes")),
        )

    @property
    def production(self):
        return self.env == "production"

    def validate(self):
        errors, warnings = [], []
        if self.storage not in ("sqlite", "jsonl"):
            errors.append("WXBST_STORAGE 必须是 sqlite 或 jsonl")
        if self.auth_mode not in ("off", "token"):
            errors.append("WXBST_AUTH_MODE 必须是 off 或 token")
        if self.auth_mode == "token" and not self.tokens:
            errors.append("token 模式必须配置 WXBST_API_TOKENS")
        if self.production and self.auth_mode == "off":
            warnings.append("生产环境未开启应用层 token 鉴权；请确保由反向代理（nginx basic auth / SSO）保护")
        if self.production and self.storage == "jsonl":
            warnings.append("生产环境仍使用 JSONL 存储，多实例部署与备份能力不足")
        if self.hsts and not self.production:
            warnings.append("HSTS 仅在 HTTPS 生产环境开启，请确认已启用 TLS")
        return errors, warnings

    def role_for_token(self, token):
        import hmac
        token = token or ""
        for candidate, role in self.tokens.items():
            if hmac.compare_digest(token, candidate):
                return role
        return ""

    def info(self):
        return {
            "env": self.env,
            "storage": self.storage,
            "authMode": self.auth_mode,
            "trustProxy": self.trust_proxy,
            "hsts": self.hsts,
        }
