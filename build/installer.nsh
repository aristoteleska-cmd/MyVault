; Records the language chosen on the installer's first screen so MyVault can
; open in that language the first time it runs. Nothing else is written, and the
; value is only ever read as a hint.
!macro customInstall
  WriteRegStr HKCU "Software\MyVault" "InstallerLanguage" "$LANGUAGE"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\MyVault"
!macroend
