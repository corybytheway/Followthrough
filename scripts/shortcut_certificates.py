# Created by Cory McCabe
"""Validate Shortcut signing chains against macOS's built-in Apple roots."""
from pathlib import Path
import subprocess


def verify_signing_chain(certificates, folder, *, verification_time=None):
    if not isinstance(certificates, list) or not certificates:
        raise ValueError('Shortcut signing certificate chain is missing')
    folder = Path(folder)
    paths = []
    for index, certificate in enumerate(certificates):
        path = folder / f'certificate-{index}.pem'
        path.write_bytes(subprocess.check_output([
            '/usr/bin/openssl', 'x509', '-inform', 'DER', '-outform', 'PEM'], input=certificate))
        paths.append(path)

    # Only the protected OS root store supplies trust anchors. Embedded roots
    # and user-installed certificates must never become trusted implicitly.
    roots = folder / 'apple-roots.pem'
    roots.write_bytes(subprocess.check_output([
        '/usr/bin/security', 'find-certificate', '-a', '-c', 'Apple Root CA', '-p',
        '/System/Library/Keychains/SystemRootCertificates.keychain']))
    if b'-----BEGIN CERTIFICATE-----' not in roots.read_bytes():
        raise ValueError('Built-in Apple root certificates are unavailable')
    empty_ca_directory = folder / 'empty-ca-directory'
    empty_ca_directory.mkdir()
    command = ['/usr/bin/openssl', 'verify', '-CAfile', str(roots),
               '-CApath', str(empty_ca_directory), '-check_ss_sig']
    if len(paths) > 1:
        intermediates = folder / 'untrusted-chain.pem'
        intermediates.write_bytes(b''.join(path.read_bytes() for path in paths[1:]))
        command += ['-untrusted', str(intermediates)]
    # OpenSSL verifies each chain certificate's validity at the current time.
    # The override is only used by regression tests for expiry/not-yet-valid.
    if verification_time is not None:
        command += ['-attime', str(int(verification_time))]
    command.append(str(paths[0]))
    subprocess.run(command, check=True, capture_output=True)
    return paths[0]
