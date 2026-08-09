; Extra behaviour bolted onto the installer electron-builder generates.
; This file is compiled ahead of the generated script, so !defines made here
; reach the page declarations that come later.

!include LogicLib.nsh

; ---------------------------------------------------------------------------
; The "choose a folder" page
;
; By default NSIS re-checks the folder box on every keystroke and greys out the
; Install button the moment it dislikes what it sees. There is no explanation on
; screen — the button simply stops working — and it rejects perfectly ordinary
; answers: a bare drive root such as D:\, a folder that does not exist yet, a
; drive it cannot measure the free space of. A shopkeeper trying to put MyVault
; on their second drive just hits a dead end.
;
; "leave" verification keeps the button alive and moves the check to the moment
; it is pressed, where we can look at the folder ourselves and say something
; useful. Both forms are set: the !define is what the Modern UI reads, and the
; bare instruction is the underlying NSIS attribute it maps to.
!define MUI_DIRECTORYPAGE_VERIFYONLEAVE
DirVerify leave

!ifndef BUILD_UNINSTALLER
  ; Where the installer would have put MyVault if nobody touched the box. Used
  ; as the last resort when the chosen folder turns out to be unwritable.
  Var defaultInstallDir

  !macro customInit
    StrCpy $defaultInstallDir $INSTDIR
  !macroend

  ; Sits immediately after the directory page and is never actually shown — it
  ; exists so that the folder can be tidied up and tested the moment the user
  ; presses Install, while there is still a window on screen to complain in.
  !macro customPageAfterChangeDir
    Page custom acceptInstallDir
  !macroend

  Function acceptInstallDir
    ; An empty box means "wherever you like".
    ${If} $INSTDIR == ""
      StrCpy $INSTDIR $defaultInstallDir
    ${EndIf}

    ; "D:\" becomes "D:", so appending below gives D:\MyVault rather than D:\\MyVault.
    StrCpy $0 $INSTDIR 1 -1
    ${If} $0 == "\"
      StrCpy $INSTDIR $INSTDIR -1
    ${EndIf}

    ; Install into a MyVault folder, never loose in a drive root — otherwise
    ; uninstalling would take the rest of the drive with it. electron-builder
    ; does this too, but it looks for "MyVault" anywhere in the path; checking
    ; the tail means "D:\MyVaultBackups" still gets its own subfolder.
    StrLen $1 "${APP_FILENAME}"
    IntOp $1 $1 + 1
    IntOp $2 0 - $1
    StrCpy $0 $INSTDIR $1 $2
    ${If} $0 != "\${APP_FILENAME}"
      StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
    ${EndIf}

    ; Now prove the folder can be written to, rather than discovering halfway
    ; through the copy that it cannot. A second drive, a USB stick and a network
    ; share all pass this if they are genuinely writable.
    ClearErrors
    CreateDirectory "$INSTDIR"
    FileOpen $3 "$INSTDIR\.myvault-write-test" w
    ${IfNot} ${Errors}
      FileClose $3
      Delete "$INSTDIR\.myvault-write-test"
      Abort ; folder is fine — skip this page and start installing
    ${EndIf}

    ; Read-only, full, or needing rights this installer was not given. Say so
    ; and carry on somewhere that works, rather than failing mid-install.
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "MyVault cannot write to:$\r$\n$INSTDIR$\r$\n$\r$\nThat drive or folder may be read-only, full, or need administrator rights.$\r$\n$\r$\nMyVault will be installed here instead:$\r$\n$defaultInstallDir"
    StrCpy $INSTDIR $defaultInstallDir
    Abort
  FunctionEnd
!endif

; Records the language chosen on the installer's first screen so MyVault can
; open in that language the first time it runs. Nothing else is written, and the
; value is only ever read as a hint.
!macro customInstall
  WriteRegStr HKCU "Software\MyVault" "InstallerLanguage" "$LANGUAGE"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\MyVault"
!macroend
