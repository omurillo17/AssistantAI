FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts

# Sin root: un fallo en el parser de CV/INE o en una dependencia no regala el
# contenedor. UID 1000 = el mismo que `node` en el frontend, para que los dos
# puedan escribir en virgo_data/ (bind mount) con un solo chown en el host.
RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin app
USER app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
