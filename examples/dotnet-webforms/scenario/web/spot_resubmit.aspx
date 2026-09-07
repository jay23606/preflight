<%@ Page Language="C#" %>
<%@ Import Namespace="System.Data" %>
<%@ Import Namespace="Microsoft.Extensions.Logging" %>
<script runat="server">
  protected void Page_Load(object sender, EventArgs e)
  {
      Response.Write("resubmit");
  }
</script>
<html><body><h1>Spot resubmit</h1></body></html>
