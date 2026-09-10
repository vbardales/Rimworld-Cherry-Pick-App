using System.Xml.Linq;

namespace CherryPick;

// Loading a mod's XML, whatever the author saved it as.
//
// XDocument.Load(path) trusts the encoding written in the XML declaration. Mods
// are not written by tools that keep the two in step: some are saved as UTF-16
// from a Windows editor while the declaration still says utf-8, left over from
// whatever file they were copied from. .NET refuses those outright, and the
// exception carries no hint that the file itself is perfectly well-formed.
//
// The byte order mark is the reliable witness, so we decode by BOM and let the
// declaration say what it likes. Passing a TextReader is what makes that
// possible: the text is already decoded by the time the parser sees it, so the
// declared encoding is no longer consulted.
//
// This cost one mod its name and its packageId — Smokeleaf Genetics: Gurgungo
// Grape appeared as a bare Workshop number, and only that number, because the
// About it declares everything in could not be opened.
public static class XmlFile
{
    public static XDocument Load(string path, LoadOptions options = LoadOptions.None)
    {
        // detectEncodingFromByteOrderMarks is the default, but this is the whole
        // point of the helper: say it.
        using var reader = new StreamReader(path, detectEncodingFromByteOrderMarks: true);
        return XDocument.Load(reader, options);
    }
}
