# Created by Cory McCabe
"""macOS regression checks for signed Shortcut trust and certificate validity."""
from pathlib import Path
import plistlib
import ssl
import subprocess
import sys
import tempfile
import unittest
from shortcut_certificates import verify_signing_chain

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / 'public/shortcuts/Followthrough Task.shortcut'
VERIFIER = ROOT / 'scripts/verify-shortcut.py'


def command(*args, **kwargs):
    return subprocess.check_output(args, stderr=subprocess.PIPE, **kwargs)


class ShortcutCertificateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        archive = ARTIFACT.read_bytes()
        size = int.from_bytes(archive[8:12], 'little')
        cls.chain = plistlib.loads(archive[12:12 + size])['SigningCertificateChain']

    def test_current_download_passes_full_verification(self):
        output = command(sys.executable, str(VERIFIER), '--signed-artifact', str(ARTIFACT))
        self.assertIn(b'chain trusted to a built-in Apple root and currently valid', output)

    def check_invalid_time(self, field, delta, expected_error):
        date = command('/usr/bin/openssl', 'x509', '-inform', 'DER', '-noout',
                       '-' + field, input=self.chain[0]).decode().strip().split('=', 1)[1]
        when = ssl.cert_time_to_seconds(date) + delta
        with tempfile.TemporaryDirectory(prefix='ft-certificate-time-') as folder:
            with self.assertRaises(subprocess.CalledProcessError) as failure:
                verify_signing_chain(self.chain, folder, verification_time=when)
            self.assertIn(expected_error, failure.exception.stdout + failure.exception.stderr)

    def test_not_yet_valid_certificate_is_rejected(self):
        self.check_invalid_time('startdate', -1, b'certificate is not yet valid')

    def test_expired_certificate_is_rejected(self):
        self.check_invalid_time('enddate', 1, b'certificate has expired')

    def test_self_signed_archive_with_apple_named_certificate_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix='ft-untrusted-shortcut-') as folder:
            folder = Path(folder)
            private_key = folder / 'untrusted-key.pem'
            command('/usr/bin/openssl', 'ecparam', '-name', 'prime256v1',
                    '-genkey', '-noout', '-out', str(private_key))
            certificate = folder / 'untrusted.der'
            command('/usr/bin/openssl', 'req', '-new', '-x509', '-key', str(private_key),
                    '-subj', '/CN=Apple Root CA - G3/O=Apple Inc./C=US', '-days', '1',
                    '-outform', 'DER', '-out', str(certificate))
            untrusted_chain = [certificate.read_bytes()]
            chain_folder = folder / 'chain'
            chain_folder.mkdir()
            with self.assertRaises(subprocess.CalledProcessError):
                verify_signing_chain(untrusted_chain, chain_folder)

            # Re-sign the actual workflow with the arbitrary key. Its archive
            # signature is valid, but it must not pass Apple trust validation.
            leaf = folder / 'real-leaf.der'
            leaf.write_bytes(self.chain[0])
            real_public_key = folder / 'real-public.pem'
            real_public_key.write_bytes(command('/usr/bin/openssl', 'x509', '-inform', 'DER',
                                                '-in', str(leaf), '-pubkey', '-noout'))
            payload = folder / 'workflow.aar'
            command('/usr/bin/aea', 'decrypt', '-i', str(ARTIFACT), '-o', str(payload),
                    '-sign-pub', str(real_public_key))
            metadata = folder / 'metadata.plist'
            metadata.write_bytes(plistlib.dumps({'SigningCertificateChain': untrusted_chain}))
            forged = folder / 'untrusted.shortcut'
            command('/usr/bin/aea', 'encrypt', '-profile', '0', '-i', str(payload),
                    '-o', str(forged), '-sign-priv', str(private_key), '-auth-data', str(metadata))
            untrusted_public_key = folder / 'untrusted-public.pem'
            untrusted_public_key.write_bytes(command('/usr/bin/openssl', 'x509', '-inform', 'DER',
                                                     '-in', str(certificate), '-pubkey', '-noout'))
            command('/usr/bin/aea', 'decrypt', '-i', str(forged),
                    '-o', str(folder / 'verified-signature.aar'), '-sign-pub', str(untrusted_public_key))
            result = subprocess.run([sys.executable, str(VERIFIER), '--signed-artifact', str(forged)],
                                    capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b'verify_signing_chain', result.stderr)
            self.assertNotIn(b'archive signature verified', result.stdout)


if __name__ == '__main__':
    unittest.main()
