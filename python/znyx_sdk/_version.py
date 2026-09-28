"""Single source of the Python SDK's version.

Its own module, rather than a constant in ``__init__``, so that ``client`` can
read the version for its request headers without importing the package root
(``__init__`` imports ``client``, so that would be a cycle).

Read from installed package metadata, never a literal. The publish workflow
stamps the release tag into ``python/pyproject.toml`` ONLY
(``sed -i ... python/pyproject.toml``), so a literal in the source tree is never
updated by a release and silently goes stale. It had: every published wheel from
1.1.2 onward shipped ``__version__ = "1.1.2"``, 1.2.1 included, so telemetry
reported 1.1.2 for every install regardless of the version actually running.

Reading the metadata pip installed makes this self-correcting and needs no change
to the release workflow. The fallback marks a source-tree import (no .dist-info)
as obviously-unreal rather than guessing a plausible number.
"""

try:
    from importlib.metadata import PackageNotFoundError, version as _pkg_version

    try:
        __version__ = _pkg_version("znyx-sdk")
    except PackageNotFoundError:  # source tree, not installed
        __version__ = "0.0.0+unknown"
except ImportError:  # pragma: no cover - importlib.metadata is stdlib on 3.8+
    __version__ = "0.0.0+unknown"

__all__ = ["__version__"]
