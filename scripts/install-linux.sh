#!/usr/bin/env bash
# Instala o Nexo DB para o usuário atual (sem sudo): binários em ~/.local/opt,
# ícone no tema hicolor e atalho no menu de aplicativos.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/dist/linux-unpacked"
DEST="$HOME/.local/opt/nexo-db"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor"

if [ ! -x "$SRC/nexo-db" ]; then
  echo "Build não encontrado em $SRC — rode 'npm run dist:linux' antes." >&2
  exit 1
fi

# substitui a instalação anterior de uma vez, sem deixar arquivos velhos
rm -rf "$DEST.new"
mkdir -p "$(dirname "$DEST")"
cp -a "$SRC" "$DEST.new"
rm -rf "$DEST"
mv "$DEST.new" "$DEST"

for size in 512 256 128 64 48 32; do
  mkdir -p "$ICONS/${size}x${size}/apps"
  if command -v python3 >/dev/null && python3 -c "import PIL" 2>/dev/null; then
    python3 -c "from PIL import Image; Image.open('$ROOT/resources/icon.png').resize(($size, $size), Image.LANCZOS).save('$ICONS/${size}x${size}/apps/nexo-db.png')"
  else
    cp "$ROOT/resources/icon.png" "$ICONS/${size}x${size}/apps/nexo-db.png"
  fi
done

mkdir -p "$APPS"
cat > "$APPS/nexo-db.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Nexo DB
GenericName=Cliente PostgreSQL
Comment=Cliente PostgreSQL moderno com autocomplete
Exec="$DEST/nexo-db" %U
Icon=nexo-db
Terminal=false
Categories=Development;Database;
Keywords=postgres;postgresql;sql;database;banco;
StartupWMClass=nexo-db
StartupNotify=true
DESKTOP

command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$ICONS" >/dev/null 2>&1 || true

echo "Nexo DB instalado em $DEST"
echo "Procure por \"Nexo DB\" no menu de aplicativos."
