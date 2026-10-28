# -*- coding: utf-8 -*-
import base64, ctypes, ctypes.wintypes as wt, os, subprocess
class CREDENTIAL(ctypes.Structure):
    _fields_ = [("Flags", wt.DWORD), ("Type", wt.DWORD), ("TargetName", wt.LPWSTR), ("Comment", wt.LPWSTR), ("LastWritten", wt.FILETIME), ("CredentialBlobSize", wt.DWORD), ("CredentialBlob", ctypes.c_void_p), ("Persist", wt.DWORD), ("AttributeCount", wt.DWORD), ("Attributes", ctypes.c_void_p), ("TargetAlias", wt.LPWSTR), ("UserName", wt.LPWSTR)]
advapi=ctypes.windll.advapi32
advapi.CredReadW.argtypes=[wt.LPCWSTR,wt.DWORD,wt.DWORD,ctypes.POINTER(ctypes.c_void_p)]; advapi.CredReadW.restype=wt.BOOL; advapi.CredFree.argtypes=[ctypes.c_void_p]
ptr=ctypes.c_void_p()
if not advapi.CredReadW("GitHub - https://api.github.com/2279896838-ai",1,0,ctypes.byref(ptr)): raise SystemExit("no token")
try:
    cred=ctypes.cast(ptr,ctypes.POINTER(CREDENTIAL)).contents; blob=ctypes.string_at(cred.CredentialBlob,cred.CredentialBlobSize); token=blob.decode("utf-8","ignore").strip("\x00 \r\n")
    if not (token.startswith("gh") or token.startswith("github_pat_")): token=blob.decode("utf-16-le","ignore").strip("\x00 \r\n")
finally: advapi.CredFree(ptr)
auth=base64.b64encode(("2279896838-ai:"+token).encode("ascii")).decode("ascii"); root=os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
r=subprocess.run(["git","-c","credential.helper=","-c","http.extraHeader=Authorization: Basic "+auth,"push","-u","origin","main"],cwd=root,capture_output=True,text=True,timeout=180)
print("exit",r.returncode); print((r.stdout+"\n"+r.stderr)[-500:].replace(token,"***"))
