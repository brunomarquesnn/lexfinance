// Gerador de certificado SSL autoassinado para desenvolvimento
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const certDir = path.join(__dirname, 'cert');
if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

// Gerar par de chaves RSA
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

// Criar certificado autoassinado usando API nativa do Node 22+
// Criamos um certificado usando o formato X.509 manual via ASN1
// Para simplificar, usamos o método de forge-free certificate creation

// Alternativa: usar child_process com openssl se disponível, 
// ou gerar via API do Node.js TLS

// Método: Criar certificado via TLS createSecureContext
const { X509Certificate } = crypto;

// Gerar CSR e certificado usando o módulo 'tls' interno
const tls = require('tls');

// Abordagem simplificada: gerar chaves e criar um servidor que aceita conexões inseguras
fs.writeFileSync(path.join(certDir, 'key.pem'), privateKey);

// Para gerar um certificado autoassinado sem openssl, 
// usamos a nova API createCertificate do Node.js (disponível em v22+)
try {
    // Node.js v22+ tem crypto.createCertificate 
    if (typeof crypto.createCertificate === 'function') {
        const cert = crypto.createCertificate({
            subject: { CN: 'localhost' },
            issuer: { CN: 'localhost' },
            key: privateKey,
            serialNumber: '01',
            notBefore: new Date(),
            notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        });
        fs.writeFileSync(path.join(certDir, 'cert.pem'), cert);
        console.log('✅ Certificado SSL gerado com sucesso!');
    } else {
        throw new Error('createCertificate not available');
    }
} catch (e) {
    // Fallback: gerar usando generateCertSync do node:tls
    try {
        const { generateCertSync } = require('node:tls');
        if (generateCertSync) {
            const { cert, key } = generateCertSync({ subject: 'CN=localhost' });
            fs.writeFileSync(path.join(certDir, 'cert.pem'), cert);
            fs.writeFileSync(path.join(certDir, 'key.pem'), key);
            console.log('✅ Certificado SSL gerado com sucesso (via TLS)!');
        } else {
            throw new Error('no generateCertSync');
        }
    } catch (e2) {
        console.log('⚠️  Não foi possível gerar certificado nativamente.');
        console.log('    Gerando certificado inline no servidor...');
        // Salvar flag para o servidor saber que deve gerar inline
        fs.writeFileSync(path.join(certDir, 'use-inline.flag'), 'true');
    }
}
