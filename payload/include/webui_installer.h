/* The PS5Upload installer daemon (payload/installer), embedded by xxd as build/webui_installer.c
 * (payload/Makefile) with its INST_VERSION, for the console page's package install (webui_pkg.c):
 * sent to the ELF loader when no daemon of that version answers on :9115. */
#ifndef PS5UPLOAD_WEBUI_INSTALLER_H
#define PS5UPLOAD_WEBUI_INSTALLER_H

extern unsigned char webui_installer_elf[];
extern unsigned int webui_installer_elf_len;
extern const char webui_installer_version[];

#endif
