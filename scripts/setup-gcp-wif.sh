#!/usr/bin/env bash
# Tek seferlik GCP kurulumu: GitHub Actions → Firebase deploy için Workload
# Identity Federation (anahtarsız). Gerekçe: .github/workflows/ci.yml →
# "GCP Kimlik Doğrulama (Workload Identity Federation)" adımı.
#
# Nerede koşar: Google Cloud Shell (https://shell.cloud.google.com — gcloud
# hazır, ek kurulum yok) ya da gcloud kurulu ve `gcloud auth login` yapılmış
# herhangi bir makinede. Proje Sahibi (Owner) yetkisi gerekir.
#
# Idempotent: her adım "zaten var" durumunda hata vermeden geçer; yarıda
# kalırsa yeniden çalıştırılabilir.
#
# Sonunda GitHub'a eklenecek iki secret'ı ve `gh secret set` komutlarını
# yazdırır. Bu değerler gizli DEĞİLDİR (kaynak adı + servis hesabı e-postası)
# ama ci.yml'deki mevcut `secrets.*` desenine uyması için secret olarak
# saklanır; WIF'in güvenliği GitHub'ın OIDC token'ı + aşağıdaki
# attribute-condition'a (yalnızca mftmcan/makam reposu) dayanır.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-muftim}"            # .firebaserc → projects.default
GITHUB_REPO="${GITHUB_REPO:-mftmcan/makam}"        # owner/repo — attribute condition bunu sınar
SA_NAME="${SA_NAME:-github-deploy}"
POOL_ID="${POOL_ID:-github}"
PROVIDER_ID="${PROVIDER_ID:-makam-repo}"

SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "▶ Proje: ${PROJECT_ID}  Repo: ${GITHUB_REPO}"
gcloud config set project "${PROJECT_ID}" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
echo "  Proje numarası: ${PROJECT_NUMBER}"

echo "▶ Gerekli API'ler etkinleştiriliyor"
gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  firebasehosting.googleapis.com \
  firebaserules.googleapis.com \
  firestore.googleapis.com \
  --quiet

echo "▶ Servis hesabı: ${SA_EMAIL}"
if ! gcloud iam service-accounts describe "${SA_EMAIL}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SA_NAME}" \
    --display-name="GitHub Actions deploy (WIF, anahtarsız)" \
    --description="ci.yml deploy/preview job'ları — Firebase Hosting + Firestore rules/indexes"
else
  echo "  zaten var, atlanıyor"
fi

# En az ayrıcalık — ci.yml'in yaptığı üç işin karşılıkları:
#   firebase deploy --only hosting            → roles/firebasehosting.admin
#   firebase hosting:channel:deploy           → roles/firebasehosting.admin
#   firebase deploy --only firestore:rules    → roles/firebaserules.admin
#   firebase deploy --only firestore:indexes  → roles/datastore.indexAdmin
#   firebase-tools'un proje/servis keşfi      → roles/firebase.viewer
#   API çağrılarının kota projesi olarak bu projeyi kullanabilmesi
#                                             → roles/serviceusage.serviceUsageConsumer
# Cloud Functions deploy'u bu pipeline'ın DIŞINDA (manuel, bkz. CLAUDE.md),
# o yüzden cloudfunctions.* rolleri bilinçli olarak verilmiyor.
echo "▶ IAM rolleri bağlanıyor"
for ROLE in \
  roles/firebasehosting.admin \
  roles/firebaserules.admin \
  roles/datastore.indexAdmin \
  roles/firebase.viewer \
  roles/serviceusage.serviceUsageConsumer
do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet >/dev/null
  echo "  ${ROLE}"
done

echo "▶ Workload Identity Pool: ${POOL_ID}"
if ! gcloud iam workload-identity-pools describe "${POOL_ID}" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "${POOL_ID}" \
    --location=global \
    --display-name="GitHub Actions"
else
  echo "  zaten var, atlanıyor"
fi

# attribute-condition: yalnızca BU reponun workflow'ları bu provider üzerinden
# kimlik alabilir — aksi halde issuer'ı GitHub olan herhangi bir repo (bir
# fork dahil) servis hesabına geçebilirdi. Fork PR'ları ayrıca ci.yml'de
# `head.repo.full_name == github.repository` ile de eleniyor; iki katman.
echo "▶ OIDC provider: ${PROVIDER_ID}"
if ! gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
      --location=global --workload-identity-pool="${POOL_ID}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
    --location=global \
    --workload-identity-pool="${POOL_ID}" \
    --display-name="GitHub ${GITHUB_REPO}" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository == '${GITHUB_REPO}'"
else
  echo "  zaten var, atlanıyor"
fi

# Repo'nun OIDC kimliğinin (principalSet) servis hesabını impersonate
# etmesine izin ver — WIF'in "anahtar yerine geçen" tek bağlantı noktası.
echo "▶ Servis hesabına workloadIdentityUser bağlanıyor"
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}" \
  --quiet >/dev/null

PROVIDER_NAME="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

cat <<EOF

✔ Kurulum tamam. GitHub repo secret'ları (Settings → Secrets and variables →
  Actions) — ya da aşağıdaki gh komutlarıyla:

  gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER --repo ${GITHUB_REPO} --body "${PROVIDER_NAME}"
  gh secret set GCP_SERVICE_ACCOUNT            --repo ${GITHUB_REPO} --body "${SA_EMAIL}"

  Eski FIREBASE_TOKEN secret'ı artık kullanılmıyor, silinebilir:
  gh secret delete FIREBASE_TOKEN --repo ${GITHUB_REPO}

  Doğrulama: main'e bir push (deploy job'ı) ya da bir PR (preview job'ı)
  "GCP Kimlik Doğrulama (Workload Identity Federation)" adımını geçmeli.
EOF
